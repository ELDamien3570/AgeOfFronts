"""Bake calibrated 16-bit heightmaps into small, browser-ready static maps.

Install scripts/heightmap-requirements.txt, then run from the repository root:
python scripts/importSkirmishHeightmap.py "HeightMaps/Mediterranean/import.json"
Original PNGs are read without resaving or changing their 16-bit values.
"""

import argparse
from collections import deque
import hashlib
import json
import math
from pathlib import Path
import struct

import numpy as np
from PIL import Image, ImageFilter
from lakeHydrology import SUPERSAMPLING, apply_lake_surfaces, load_lakes
from riverHydrology import footprint, load_rivers, river_mask


def decode_source(config_path):
    config = json.loads(config_path.read_text(encoding="utf-8"))
    source = config_path.parent / config["source"]
    source_bytes = source.read_bytes()
    digest = hashlib.sha256(source_bytes).hexdigest()
    if digest != config["sourceSha256"]:
        raise ValueError("Source changed: verify its export settings and update its hash")
    if source_bytes[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Expected a PNG heightmap")
    width, height, depth, color, compression, filtering, interlace = struct.unpack(
        ">IIBBBBB", source_bytes[16:29]
    )
    if depth != 16 or color != 0 or compression != 0 or filtering != 0:
        raise ValueError("Expected a true 16-bit grayscale PNG")
    samples = np.array(Image.open(source), dtype=np.uint16)
    if samples.shape != (height, width) or width <= 0 or height <= 0:
        raise ValueError("Invalid heightmap source dimensions")
    normalization = config["normalization"]
    lower, upper = normalization["from"], normalization["to"]
    # Manticorp's Regular encoder scales to 65536 (not 65535), then writes u16.
    # Its upper endpoint can wrap to zero. Preserve the source; majority-area
    # resampling prevents an isolated wrapped maximum from becoming a lake tile.
    if (
        normalization["mode"] != "regular"
        or normalization["range"] != 65536
        or not math.isfinite(lower)
        or not math.isfinite(upper)
        or lower >= upper
        or not lower <= config["seaLevel"] < upper
        or not config["seaLevel"] < config["terrainThresholds"]["highland"]
        < config["terrainThresholds"]["mountain"] < upper
    ):
        raise ValueError("Invalid calibrated import settings")
    return config, samples, (width, height), digest


def output_dimensions(source_width, source_height, size):
    if size not in (250, 500, 1000) or min(source_width, source_height) <= 0:
        raise ValueError("Unsupported gameplay resolution")
    longest = max(source_width, source_height)
    # Match JavaScript's positive Math.round; Python's tie-to-even differs.
    return (max(1, math.floor(size * source_width / longest + 0.5)),
            max(1, math.floor(size * source_height / longest + 0.5)))


def resample(samples, size, config):
    source_height, source_width = samples.shape
    width, height = output_dimensions(source_width, source_height, size)
    if width > source_width or height > source_height:
        raise ValueError("Heightmap baking requires a source at least as large as the output")
    x_edges = np.arange(width + 1, dtype=np.int64) * source_width // width
    y_edges = np.arange(height + 1, dtype=np.int64) * source_height // height
    lower = config["normalization"]["from"]
    upper = config["normalization"]["to"]
    sea_code = math.floor((config["seaLevel"] - lower) * 65536 / (upper - lower))
    land = np.zeros((height, width), dtype=bool)
    elevations = np.zeros((height, width), dtype=np.float32)
    for y in range(height):
        rows = samples[y_edges[y]:y_edges[y + 1]]
        mask = rows > sea_code
        counts = np.add.reduceat(mask.sum(axis=0), x_edges[:-1])
        totals = np.diff(x_edges) * rows.shape[0]
        land_sum = np.add.reduceat(
            np.where(mask, rows, 0).sum(axis=0, dtype=np.uint64), x_edges[:-1]
        )
        water_sum = np.add.reduceat(
            np.where(mask, 0, rows).sum(axis=0, dtype=np.uint64), x_edges[:-1]
        )
        # Exact ties are water. Heights average only the winning surface type,
        # keeping water at/below sea level and dry cells strictly above it.
        dry = counts * 2 > totals
        land[y] = dry
        count = np.where(dry, counts, totals - counts)
        mean = np.where(dry, land_sum, water_sum) / count
        elevations[y] = lower + mean * (upper - lower) / 65536
    return land, elevations, sea_code


def encode_terrain(land, elevations, config):
    height, width = land.shape
    ocean = np.zeros_like(land)
    queue = deque()
    for y, x in (
        [(0, x) for x in range(width)] + [(height - 1, x) for x in range(width)]
        + [(y, 0) for y in range(height)] + [(y, width - 1) for y in range(height)]
    ):
        if not land[y, x] and not ocean[y, x]:
            ocean[y, x] = True
            queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= yy < height and 0 <= xx < width and not land[yy, xx] and not ocean[yy, xx]:
                ocean[yy, xx] = True
                queue.append((yy, xx))
    thresholds = config["terrainThresholds"]
    magnitude = np.where(elevations < thresholds["highland"], 5,
                         np.where(elevations < thresholds["mountain"], 15, 25))
    terrain = np.where(land, 128 | magnitude, np.where(ocean, 32, 0)).astype(np.uint8)
    shore = np.zeros_like(land)
    shore[1:] |= land[1:] & ~land[:-1]
    shore[:-1] |= land[:-1] & ~land[1:]
    shore[:, 1:] |= land[:, 1:] & ~land[:, :-1]
    shore[:, :-1] |= land[:, :-1] & ~land[:, 1:]
    terrain[shore] |= 64
    return terrain


def smoothstep(low, high, value):
    t = np.clip((value - low) / (high - low), 0, 1)
    return t * t * (3 - 2 * t)


def classify_albedo(rgb, green_sensitivity=1.0):
    """Approximate visible-color evidence, not scientific land-cover inference.

    Ratios reduce brightness/shadow sensitivity. No pixel changes terrain height
    or water authority. The outputs are continuous inputs, not hard color buckets.
    """
    if not math.isfinite(green_sensitivity) or not 0.5 <= green_sensitivity <= 2:
        raise ValueError("Invalid albedo green sensitivity")
    colors = np.asarray(rgb, dtype=np.float32) / 255
    red, green, blue = colors[..., 0], colors[..., 1], colors[..., 2]
    green_ratio = (green - red) / np.maximum(0.03, green + red)
    greenness = np.minimum(1, smoothstep(-0.05, 0.10, green_ratio) * green_sensitivity)
    brightness = colors.mean(axis=-1)
    brownness = smoothstep(-0.03, 0.14, -green_ratio)
    water_hint = (blue > red + 0.04) & (blue > green + 0.008)
    moisture = 0.15 + 0.72 * greenness
    vegetation = 0.04 + 0.93 * greenness
    aridity = brownness * (0.45 + 0.55 * smoothstep(0.23, 0.75, brightness))
    vegetation[water_hint] = 0
    aridity[water_hint] = 0
    moisture[water_hint] = 0.9
    return np.stack((moisture, vegetation, aridity), axis=-1), water_hint


def bake_environment(image, land, size, smoothing, green_sensitivity=1.0):
    height, width = land.shape
    rgb = np.array(image.resize((width, height), Image.Resampling.BOX), dtype=np.uint8)
    fields, water_hint = classify_albedo(rgb, green_sensitivity)
    radius = smoothing * size / 500
    weights = np.array(Image.fromarray(land.astype(np.uint8) * 255).filter(
        ImageFilter.GaussianBlur(radius)), dtype=np.float32) / 255
    channels = []
    for channel in range(3):
        weighted = np.rint(fields[..., channel] * land * 255).astype(np.uint8)
        blurred = np.array(Image.fromarray(weighted).filter(
            ImageFilter.GaussianBlur(radius)), dtype=np.float32) / 255
        field = np.clip(blurred / np.maximum(weights, 1 / 255), 0, 1)
        field[~land] = 0
        channels.append(np.rint(field * 255).astype(np.uint8))
    output = np.stack(channels, axis=-1)
    union = (water_hint | ~land).sum()
    return output, {
        "waterHintAgreement": float((water_hint == ~land).mean()),
        "waterHintIoU": float((water_hint & ~land).sum() / union) if union else None,
        "meanLandMoisture": float(output[..., 0][land].mean() / 255),
        "meanLandVegetation": float(output[..., 1][land].mean() / 255),
        "meanLandAridity": float(output[..., 2][land].mean() / 255),
    }


def bake(config_path):
    config, samples, dimensions, digest = decode_source(config_path)
    root = Path(__file__).resolve().parents[1]
    output = (root / config["output"]).resolve()
    if not output.is_relative_to(root / "resources" / "maps"):
        raise ValueError("Output must stay inside resources/maps")
    output.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schemaVersion": 1,
        "name": config["name"],
        "minimum": config["normalization"]["from"],
        "maximum": config["normalization"]["to"],
        "seaLevel": config["seaLevel"],
        "source": {"file": config["source"], "sha256": digest,
                   "width": dimensions[0], "height": dimensions[1], "url": config["sourceUrl"]},
        "normalization": config["normalization"],
        "terrainThresholds": config["terrainThresholds"],
        "sampling": "area-majority land/water; average height within winning surface; ties water",
        "waterRule": "calibrated sea level, not an independently verified water mask",
        "resolutionRule": "selected size is the longest edge; source aspect ratio preserved",
        "variants": {},
    }
    if config.get("climate"):
        climate_path = (config_path.parent / config["climate"]).resolve()
        if not climate_path.is_relative_to(root):
            raise ValueError("Climate input must stay inside the project")
        manifest["climate"] = json.loads(climate_path.read_text(encoding="utf-8"))
    albedo = None
    if config.get("albedo"):
        settings = config["albedo"]
        albedo_path = (config_path.parent / settings["source"]).resolve()
        if not albedo_path.is_relative_to(root):
            raise ValueError("Albedo input must stay inside the project")
        albedo_digest = hashlib.sha256(albedo_path.read_bytes()).hexdigest()
        if albedo_digest != settings["sourceSha256"]:
            raise ValueError("Albedo source changed: review and update its hash")
        albedo = Image.open(albedo_path).convert("RGB")
        if settings.get("registration") != "same-footprint" or albedo.size != dimensions:
            raise ValueError("Albedo must have an explicitly registered matching footprint")
        smoothing = settings.get("smoothingCellsAt500", 1.4)
        if not math.isfinite(smoothing) or not 0 <= smoothing <= 8:
            raise ValueError("Invalid albedo smoothing")
        green_sensitivity = settings.get("greenSensitivity", 1.0)
        if not math.isfinite(green_sensitivity) or not 0.5 <= green_sensitivity <= 2:
            raise ValueError("Invalid albedo green sensitivity")
        manifest["environment"] = {
            "schemaVersion": 1, "encoding": "u8-moisture-vegetation-aridity",
            "classifier": "visible-color-gradients-v1",
            "smoothingCellsAt500": smoothing,
            "greenSensitivity": green_sensitivity,
            "source": {"file": settings["source"], "sha256": albedo_digest,
                       "width": dimensions[0], "height": dimensions[1],
                       "registration": settings["registration"]},
            "interpretation": "approximate color-derived moisture, vegetation and aridity; height/water remain authoritative",
            "variants": {},
        }
    lakes = None
    if config.get("lakes"):
        settings = config["lakes"]
        lakes, lake_digest = load_lakes(config_path, settings)
        manifest["lakes"] = {
            "schemaVersion": 1,
            "source": {**lakes.get("source", {}), "file": settings["source"],
                       "sha256": lake_digest},
            "surfaceElevationsMeters": settings["surfaceElevationsMeters"],
            "registration": "geographic polygons projected into the original Web Mercator footprint",
            "sampling": f"{SUPERSAMPLING}x{SUPERSAMPLING} centre-sampled union coverage; majority and ties water; holes retain islands; mixed cells use dominant lake level with source-order ties",
            "interpretation": "explicit inland water with flat authored surface elevations; source PNG and all heights outside lake masks preserved",
            "variants": {},
        }
    rivers = None
    if config.get("rivers"):
        rivers, river_digest = load_rivers(config_path, config["rivers"])
        manifest["hydrology"] = {
            "schemaVersion": 1,
            "source": {"file": config["rivers"]["source"], "sha256": river_digest,
                       **rivers["source"]},
            "names": sorted({f["properties"]["name"] for f in rivers["features"]}),
            "widthCellsAt500": config["rivers"]["widthCellsAt500"],
            "widthCellsBySize": config["rivers"].get("widthCellsBySize"),
            "registration": "geographic lines projected into the original Web Mercator footprint",
            "interpretation": "major rivers are four-connected navigable water; gameplay widths exaggerated; original elevations preserved",
            "variants": {},
        }
        manifest["waterRule"] = "calibrated sea level plus explicitly authored major-river hydrology"
    if lakes is not None:
        manifest["waterRule"] += " plus registered lake polygons with explicit surface elevations"
    for size in config["sizes"]:
        land, heights, sea_code = resample(samples, size, config)
        sea_water = ~land.copy()
        lake_water = np.zeros_like(land)
        if lakes is not None:
            lake_water, metrics = apply_lake_surfaces(
                land, heights, lakes, footprint(config, dimensions),
                config["lakes"]["surfaceElevationsMeters"], config)
            manifest["lakes"]["variants"][str(size)] = metrics
        if rivers is not None:
            channels = river_mask(rivers, footprint(config, dimensions), land.shape,
                                  config["rivers"]["widthCellsAt500"],
                                  config["rivers"].get("widthCellsBySize", {}).get(str(size)))
            manifest["hydrology"]["variants"][str(size)] = {
                "channelCells": int(channels.sum()),
                "newWaterCells": int((channels & land).sum()),
            }
            land &= ~channels
        terrain = encode_terrain(land, heights, config)
        (output / f"{size}.terrain.bin").write_bytes(terrain.tobytes())
        (output / f"{size}.heights.f32").write_bytes(heights.astype("<f4").tobytes())
        if albedo is not None:
            fields, metrics = bake_environment(albedo, land, size, smoothing, green_sensitivity)
            (output / f"{size}.environment.bin").write_bytes(fields.tobytes())
            manifest["environment"]["variants"][str(size)] = metrics
        assert np.all(heights[land] > config["seaLevel"])
        assert np.all(heights[sea_water & ~lake_water] <= config["seaLevel"])
        manifest["variants"][str(size)] = {
            "width": int(land.shape[1]), "height": int(land.shape[0]), "landCells": int(land.sum()),
            "seaCode": sea_code, "heightMinimum": float(heights.min()),
            "heightMaximum": float(heights.max()),
        }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    bake(parser.parse_args().config.resolve())
