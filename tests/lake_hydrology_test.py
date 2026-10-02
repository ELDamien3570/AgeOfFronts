"""Offline lake regression tests: python -m unittest discover -s tests -p '*_test.py'."""
import hashlib
import json
import math
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from importSkirmishHeightmap import bake_environment, encode_terrain
from lakeHydrology import apply_lake_surfaces, lake_surfaces, load_lakes


def position(x, y):
    return [x * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y))))]


def box(left, top, right, bottom):
    return [position(x, y) for x, y in [(left, top), (right, top),
                                      (right, bottom), (left, bottom), (left, top)]]


def lake(name="Test lake", rings=None):
    return {"type": "Feature", "properties": {"name": name},
            "geometry": {"type": "Polygon", "coordinates": rings or [box(.2, .2, .8, .8)]}}


def document(*features):
    return {"type": "FeatureCollection", "features": list(features or [lake()])}


class LakeTests(unittest.TestCase):
    def test_flat_elevated_water_uses_terrain_authority_and_clears_environment(self):
        land = np.ones((20, 20), dtype=bool)
        heights = np.arange(400, dtype=np.float32).reshape(20, 20) + 100
        before = heights.copy()
        config = {"normalization": {"from": -450, "to": 6501}, "seaLevel": 0,
                  "terrainThresholds": {"highland": 600, "mountain": 1800}}
        mask, stats = apply_lake_surfaces(land, heights, document(), (0, 0, 1, 1),
                                         {"Test lake": 183.2}, config)
        self.assertGreater(stats["surfaceCells"], 100)
        self.assertEqual(stats["surfaceCells"], stats["newWaterCells"])
        self.assertTrue(np.all(heights[mask] == np.float32(183.2)))
        self.assertTrue(np.array_equal(heights[~mask], before[~mask]))
        self.assertFalse(np.any(land[mask]))
        terrain = encode_terrain(land, heights, config)
        self.assertTrue(np.all(terrain[mask] == 0))
        self.assertTrue(np.any((terrain[land] & 64) != 0))
        fields, _ = bake_environment(Image.new("RGB", (20, 20), (95, 125, 65)),
                                     land, 500, 1.4)
        self.assertTrue(np.all(fields[mask] == 0))
        self.assertGreater(int(fields[land].sum()), 0)

    def test_holes_islands_and_multipolygons_are_preserved(self):
        feature = lake(rings=[box(.1, .1, .6, .8), box(.25, .25, .45, .6)])
        feature["geometry"] = {"type": "MultiPolygon", "coordinates": [
            feature["geometry"]["coordinates"], [box(.75, .3, .9, .7)]]}
        mask, surface, _ = lake_surfaces(document(feature), (0, 0, 1, 1), (40, 40),
                                        {"Test lake": 176})
        self.assertTrue(mask[8, 8])
        self.assertFalse(mask[16, 14])
        self.assertTrue(mask[20, 33])
        self.assertFalse(mask[20, 27])
        self.assertTrue(np.all(surface[mask] == 176))
        self.assertTrue(np.array_equal(mask, lake_surfaces(document(feature),
                        (0, 0, 1, 1), (40, 40), {"Test lake": 176})[0]))

    def test_half_cell_coverage_is_water_and_less_than_half_stays_land(self):
        # These are projected coordinates, so area is directly measurable.
        mask, _, _ = lake_surfaces(document(lake(rings=[box(.2, .2, .55, .8)])),
                                   (0, 0, 1, 1), (10, 10), {"Test lake": 100})
        self.assertTrue(mask[4, 5])
        mask, _, _ = lake_surfaces(document(lake(rings=[box(.2, .2, .525, .8)])),
                                   (0, 0, 1, 1), (10, 10), {"Test lake": 100})
        self.assertFalse(mask[4, 5])

    def test_opposite_shores_use_symmetric_true_subcell_coverage(self):
        # Both partial cells have 3/8 included sample columns (40% true area).
        for ring, column in [(box(.56, .2, .8, .8), 5),
                             (box(.2, .2, .54, .8), 5)]:
            mask, _, _ = lake_surfaces(document(lake(rings=[ring])),
                                       (0, 0, 1, 1), (10, 10), {"Test lake": 100})
            self.assertFalse(mask[4, column])
        for ring, column in [(box(.55, .2, .8, .8), 5),
                             (box(.2, .2, .55, .8), 5)]:
            mask, _, _ = lake_surfaces(document(lake(rings=[ring])),
                                       (0, 0, 1, 1), (10, 10), {"Test lake": 100})
            self.assertTrue(mask[4, column])

    def test_projection_clips_to_the_map_without_wrapping(self):
        mask, _, _ = lake_surfaces(document(lake(rings=[box(.1, .1, .6, .8)])),
                                   (.3, .3, .4, .4), (20, 20), {"Test lake": 100})
        self.assertTrue(np.all(mask[:, :14]))
        self.assertFalse(np.any(mask[:, 16:]))

    def test_touching_lakes_share_coverage_without_a_dry_seam(self):
        # Neither lake owns half of cell (5,4), but their union does.
        west = lake("West", [box(.2, .2, .535, .8)])
        east = lake("East", [box(.535, .2, .575, .8)])
        for eastern_level in [176, 175]:
            mask, surface, cells = lake_surfaces(document(west, east),
                (0, 0, 1, 1), (10, 10), {"West": 176, "East": eastern_level})
            self.assertTrue(mask[4, 5])
            self.assertEqual(surface[4, 5], 176)  # Equal sample counts: source order.
            self.assertEqual(sum(cells.values()), int(mask.sum()))

    def test_wholly_outside_polygons_do_not_wrap_into_the_map(self):
        for ring in [box(.1, .4, .2, .6), box(.8, .4, .9, .6),
                     box(.4, .1, .6, .2), box(.4, .8, .6, .9)]:
            mask, _, _ = lake_surfaces(document(lake(rings=[ring])),
                (.3, .3, .4, .4), (20, 20), {"Test lake": 100})
            self.assertFalse(np.any(mask))

    def test_source_hash_names_and_levels_are_validated(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "lakes.geojson"
            source.write_text(json.dumps(document()))
            settings = {"source": source.name,
                        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                        "surfaceElevationsMeters": {"Test lake": 183.2}}
            decoded, digest = load_lakes(root / "import.json", settings)
            self.assertEqual(decoded, document())
            self.assertEqual(digest, settings["sourceSha256"])
            for levels in [{}, {"Wrong name": 10}, {"Test lake": True},
                           {"Test lake": float("nan")}, {"Test lake": "100"}]:
                with self.assertRaises(ValueError):
                    load_lakes(root / "import.json", {**settings, "surfaceElevationsMeters": levels})
            with self.assertRaisesRegex(ValueError, "source changed"):
                load_lakes(root / "import.json", {**settings, "sourceSha256": "incorrect"})
            with self.assertRaisesRegex(ValueError, "input directory"):
                load_lakes(root / "import.json", {**settings, "source": "../outside.json"})

    def test_invalid_geometries_and_conflicting_surfaces_fail(self):
        invalid = []
        f = lake(); f["geometry"]["type"] = "LineString"; invalid.append(f)
        f = lake(); f["geometry"]["coordinates"][0].pop(); invalid.append(f)
        f = lake(); f["geometry"]["coordinates"][0][1][1] = 90; invalid.append(f)
        f = lake(); f["geometry"]["coordinates"][0][1][0] = float("nan"); invalid.append(f)
        for feature in invalid:
            with self.assertRaises(ValueError):
                lake_surfaces(document(feature), (0, 0, 1, 1), (20, 20), {"Test lake": 100})
        with self.assertRaisesRegex(ValueError, "different surface elevations"):
            lake_surfaces(document(lake("A"), lake("B")), (0, 0, 1, 1), (20, 20),
                          {"A": 100, "B": 200})
        with self.assertRaisesRegex(ValueError, "calibrated range"):
            apply_lake_surfaces(np.ones((20, 20), dtype=bool), np.ones((20, 20)),
                               document(), (0, 0, 1, 1), {"Test lake": 9000},
                               {"normalization": {"from": -450, "to": 6501}})
        with self.assertRaisesRegex(ValueError, "at or above sea level"):
            apply_lake_surfaces(np.ones((20, 20), dtype=bool), np.ones((20, 20)),
                               document(), (0, 0, 1, 1), {"Test lake": -100},
                               {"normalization": {"from": -450, "to": 6501}, "seaLevel": 0})


if __name__ == "__main__":
    unittest.main()
