"""Registered polygonal inland water with explicit, level surface elevations.

This offline authoring layer never infers lakes from image color or a sea-level
threshold. GeoJSON polygons define water (holes preserve islands); authored
metres define the surface. Original source PNGs and heights outside lakes stay
untouched. Small islands, shore details and narrow inlets remain resolution
limited, just like the heightmap's majority-area coastline.
"""
import hashlib
import json
import math

import numpy as np

SUPERSAMPLING = 8


def load_lakes(config_path, settings):
    path = (config_path.parent / settings["source"]).resolve()
    if not path.is_relative_to(config_path.parent.resolve()):
        raise ValueError("Lake source must stay inside its map input directory")
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != settings["sourceSha256"]:
        raise ValueError("Lake source changed: review registration and update its hash")
    document = json.loads(data)
    if (document.get("type") != "FeatureCollection"
            or not isinstance(document.get("features"), list)
            or not document["features"]):
        raise ValueError("Expected non-empty lake GeoJSON FeatureCollection")
    names = set()
    for feature in document["features"]:
        name = feature.get("properties", {}).get("name")
        if not isinstance(name, str) or not name:
            raise ValueError("Each lake needs a non-empty name")
        names.add(name)
    levels = settings.get("surfaceElevationsMeters")
    if not isinstance(levels, dict) or set(levels) != names:
        raise ValueError("Specify one surface elevation for every lake name")
    for level in levels.values():
        if type(level) not in (int, float) or not math.isfinite(level):
            raise ValueError("Lake surface elevations must be finite metres")
    return document, digest


def lake_surfaces(document, bounds, shape, levels):
    """Return authoritative water mask, flat heights and per-lake cell counts.

Eight-by-eight subcell coverage approximates majority area in the same Web
Mercator footprint as rivers and source imagery. Exact sampled ties are water.
Rings use GeoJSON order (outer ring followed by island holes), not winding.
"""
    height, width = shape
    west, north, span_x, span_y = bounds
    if (height <= 0 or width <= 0
            or not all(math.isfinite(v) for v in bounds)
            or span_x <= 0 or span_y <= 0):
        raise ValueError("Invalid lake registration footprint")
    scale = SUPERSAMPLING
    sample_shape = (height * scale, width * scale)
    surface = np.zeros(shape, dtype=np.float32)

    def ring_points(ring):
        if not isinstance(ring, list) or len(ring) < 4 or ring[0] != ring[-1]:
            raise ValueError("Lake rings must be closed with at least four positions")
        points = []
        for coordinate in ring:
            if not isinstance(coordinate, (list, tuple)) or len(coordinate) < 2:
                raise ValueError("Invalid lake coordinate")
            lon, lat = coordinate[:2]
            if (type(lon) not in (int, float) or type(lat) not in (int, float)
                    or not all(math.isfinite(v) for v in (lon, lat))
                    or abs(lon) > 180 or abs(lat) > 85.05112878):
                raise ValueError("Invalid lake coordinate")
            x = ((lon + 180) / 360 - west) / span_x * width
            mercator_y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2
            y = (mercator_y - north) / span_y * height
            points.append((x * scale, y * scale))
        return points

    def fill_ring(target, ring, value):
        # Even/odd scan conversion at true subcell centres. ImageDraw's
        # inclusive integer polygon edges bias opposite shores differently.
        # A half-open edge rule counts vertices once and preserves ring holes.
        crossings = [[] for _ in range(sample_shape[0])]
        points = ring_points(ring)
        for (ax, ay), (bx, by) in zip(points, points[1:]):
            if ay == by:
                continue
            start = max(0, math.ceil(min(ay, by) - 0.5))
            stop = min(sample_shape[0], math.ceil(max(ay, by) - 0.5))
            for row in range(start, stop):
                x = ax + (row + 0.5 - ay) * (bx - ax) / (by - ay)
                crossings[row].append(x)
        for row, values in enumerate(crossings):
            values.sort()
            for left, right in zip(values[::2], values[1::2]):
                start = max(0, min(sample_shape[1], math.ceil(left - 0.5)))
                stop = max(0, min(sample_shape[1], math.ceil(right - 0.5)))
                if start < stop:
                    target[row, start:stop] = value

    grouped = {}
    for feature in document["features"]:
        name = feature["properties"]["name"]
        geometry = feature.get("geometry") or {}
        kind = geometry.get("type")
        if kind not in ("Polygon", "MultiPolygon"):
            raise ValueError("Lake geometry must contain polygons")
        coordinates = geometry.get("coordinates")
        if not isinstance(coordinates, list) or not coordinates:
            raise ValueError("Lake geometry must contain polygons")
        polygons = [coordinates] if kind == "Polygon" else coordinates
        grouped.setdefault(name, []).extend(polygons)

    names = list(grouped)
    owner = np.zeros(sample_shape, dtype=np.min_scalar_type(len(names)))
    best_count = np.zeros(shape, dtype=np.uint16)
    dominant = np.zeros(shape, dtype=np.min_scalar_type(len(names)))
    level_by_owner = [None] + [np.float32(levels[name]) for name in names]
    for identity, (name, polygons) in enumerate(grouped.items(), start=1):
        level = levels[name]
        if type(level) not in (int, float) or not math.isfinite(level):
            raise ValueError("Lake surface elevations must be finite metres")
        coverage = np.zeros(sample_shape, dtype=bool)
        for polygon in polygons:
            if not isinstance(polygon, list) or not polygon:
                raise ValueError("Lake polygon needs an exterior ring")
            part = np.zeros(sample_shape, dtype=bool)
            for index, ring in enumerate(polygon):
                fill_ring(part, ring, index == 0)
            # A hole in this polygon must not erase another polygon's water.
            coverage |= part
        counts = coverage.reshape(height, scale, width, scale).sum(axis=(1, 3))
        for other in np.unique(owner[coverage]):
            if other and level_by_owner[other] != np.float32(level):
                raise ValueError("Overlapping lakes have different surface elevations")
        owner[coverage] = identity
        # Union all subcell coverage before majority: adjoining polygons must
        # not create artificial dry seams when neither owns half a cell alone.
        # The dominant lake supplies its level; ties retain source-file order.
        wins = counts > best_count
        best_count[wins] = counts[wins]
        dominant[wins] = identity
        surface[wins] = level
    occupied = owner != 0
    counts = occupied.reshape(height, scale, width, scale).sum(axis=(1, 3))
    water = counts * 2 >= scale * scale
    surface[~water] = 0
    cells = {name: int((water & (dominant == identity)).sum())
             for identity, name in enumerate(names, start=1)}
    return water, surface, cells


def apply_lake_surfaces(land, heights, document, bounds, levels, config):
    lower, upper = config["normalization"]["from"], config["normalization"]["to"]
    if any(not lower <= level <= upper for level in levels.values()):
        raise ValueError("Lake surface elevation is outside the calibrated range")
    if any(level < config["seaLevel"] for level in levels.values()):
        raise ValueError("Lake surface must be at or above sea level for the shared renderer")
    water, surface, cells = lake_surfaces(document, bounds, land.shape, levels)
    original_land = land.copy()
    land[water] = False
    heights[water] = surface[water]
    return water, {"surfaceCells": int(water.sum()),
                   "newWaterCells": int((water & original_land).sum()),
                   "cellsByLake": cells}
