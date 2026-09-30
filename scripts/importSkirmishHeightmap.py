"""Bake calibrated 16-bit heightmaps into small, browser-ready static maps.

Install scripts/heightmap-requirements.txt, then run from the repository root:
python scripts/importSkirmishHeightmap.py "HeightMaps/Test 1/import.json"
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
from PIL import Image


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
    if samples.shape != (height, width) or width != height * 2:
        raise ValueError("This skirmish importer expects a 2:1 source footprint")
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


def resample(samples, width, config):
    source_height, source_width = samples.shape
    height = width // 2
    if width not in (250, 500, 1000):
        raise ValueError("Unsupported gameplay resolution")
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
        "variants": {},
    }
    for size in config["sizes"]:
        land, heights, sea_code = resample(samples, size, config)
        terrain = encode_terrain(land, heights, config)
        (output / f"{size}.terrain.bin").write_bytes(terrain.tobytes())
        (output / f"{size}.heights.f32").write_bytes(heights.astype("<f4").tobytes())
        assert np.all(heights[land] > config["seaLevel"])
        assert np.all(heights[~land] <= config["seaLevel"])
        manifest["variants"][str(size)] = {
            "width": size, "height": size // 2, "landCells": int(land.sum()),
            "seaCode": sea_code, "heightMinimum": float(heights.min()),
            "heightMaximum": float(heights.max()),
        }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    bake(parser.parse_args().config.resolve())
