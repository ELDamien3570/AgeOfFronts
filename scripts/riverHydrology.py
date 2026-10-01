"""Offline geographic river rasterization; terrain remains the runtime authority.

Original elevation samples are never lowered to sea level to manufacture rivers.
Channels are deliberately widened for continental gameplay, not physical widths.
"""
import hashlib
import json
import math
from urllib.parse import urlparse

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def footprint(config, dimensions):
    parts = urlparse(config["sourceUrl"]).fragment.split("/")
    def read(key):
        return float(parts[parts.index(key) + 1])
    lat, lon, zoom = read("latitude"), read("longitude"), read("outputzoom")
    if not all(math.isfinite(v) for v in (lat, lon, zoom)) or abs(lat) > 85.05112878:
        raise ValueError("Invalid river registration footprint")
    world = 256 * 2 ** zoom
    cx = (lon + 180) / 360
    cy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2
    return cx - dimensions[0] / world / 2, cy - dimensions[1] / world / 2, dimensions[0] / world, dimensions[1] / world


def load_rivers(config_path, settings):
    path = config_path.parent / settings["source"]
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != settings["sourceSha256"]:
        raise ValueError("River source changed: review registration and update its hash")
    document = json.loads(data)
    if document.get("type") != "FeatureCollection":
        raise ValueError("Expected river GeoJSON FeatureCollection")
    width = settings["widthCellsAt500"]
    if not math.isfinite(width) or not 1 <= width <= 6:
        raise ValueError("Invalid gameplay river width")
    return document, digest


def river_mask(document, bounds, shape, width_at_500, width_cells=None):
    height, width = shape
    west, north, span_x, span_y = bounds
    if width_cells is not None and (type(width_cells) is not int or not 1 <= width_cells <= 6):
        raise ValueError("Invalid explicit river cell width")
    mask = np.zeros(shape, dtype=np.uint8)
    stroke = Image.new("L", (width, height))
    draw = ImageDraw.Draw(stroke)
    def point(coordinate):
        lon, lat = coordinate[:2]
        if not all(math.isfinite(v) for v in (lon, lat)) or abs(lat) > 85.05112878:
            raise ValueError("Invalid river coordinate")
        x = ((lon + 180) / 360 - west) / span_x * width
        mercator_y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2
        return x, (mercator_y - north) / span_y * height
    for feature in document["features"]:
        geometry = feature["geometry"]
        if geometry["type"] not in ("LineString", "MultiLineString"):
            raise ValueError("River geometry must contain lines")
        lines = [geometry["coordinates"]] if geometry["type"] == "LineString" else geometry["coordinates"]
        for line in lines:
            points = [point(c) for c in line]
            for (ax, ay), (bx, by) in zip(points, points[1:]):
                if width_cells is not None and width_cells > 1:
                    draw.line([(math.floor(ax), math.floor(ay)), (math.floor(bx), math.floor(by))], fill=1, width=width_cells)
                # Quarter-cell samples plus both corner neighbours form a
                # conservative supercover, including four-connected bends.
                steps = max(1, math.ceil(max(abs(bx - ax), abs(by - ay)) * 4))
                previous = None
                for i in range(steps + 1):
                    x, y = math.floor(ax + (bx - ax) * i / steps), math.floor(ay + (by - ay) * i / steps)
                    if 0 <= x < width and 0 <= y < height:
                        mask[y, x] = 1
                        if previous and previous[0] != x and previous[1] != y:
                            mask[y, previous[0]] = 1
                            mask[previous[1], x] = 1
                        previous = (x, y)
                    else:
                        previous = None
    radius = max(0, math.floor(width_at_500 * max(shape) / 500 / 2))
    if width_cells is not None:
        return mask.astype(bool) | np.asarray(stroke, dtype=bool)
    if radius:
        mask = np.array(Image.fromarray(mask).filter(ImageFilter.MaxFilter(radius * 2 + 1)))
    return mask.astype(bool)
