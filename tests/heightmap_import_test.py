"""Authoring tests: python -m unittest discover -s tests -p heightmap_import_test.py"""
import importlib.util
from pathlib import Path
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location(
    "heightmap_import", Path(__file__).resolve().parents[1] / "scripts/importSkirmishHeightmap.py"
)
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)

CONFIG = {
    "normalization": {"from": -450, "to": 7819},
    "seaLevel": 0,
    "terrainThresholds": {"highland": 600, "mountain": 1800},
}


class ImportTests(unittest.TestCase):
    def test_black_is_not_the_only_water_and_16_bit_detail_survives(self):
        source = np.full((250, 500), 3565, dtype=np.uint16)
        source[:, 200:] = 3568
        land, heights, threshold = importer.resample(source, 250, CONFIG)
        self.assertEqual(threshold, 3566)
        self.assertFalse(land[20, 20])
        self.assertTrue(land[20, 180])
        self.assertLess(heights[20, 20], 0)
        self.assertGreater(heights[20, 180], 0)
        self.assertLess(heights[20, 180], 1)

    def test_majority_keeps_shore_types_separate_and_isolated_bad_pixels_do_not_make_a_lake(self):
        source = np.full((250, 500), 15000, dtype=np.uint16)
        source[100, 100] = 0
        land, heights, _ = importer.resample(source, 250, CONFIG)
        self.assertTrue(land[50, 50])
        self.assertGreater(heights[50, 50], 0)
        source[100:102, 100] = 0
        land, heights, _ = importer.resample(source, 250, CONFIG)
        self.assertFalse(land[50, 50])
        self.assertEqual(heights[50, 50], -450)

    def test_ocean_connectivity_and_coastal_land_bits(self):
        land = np.ones((7, 9), dtype=bool)
        land[:, 0] = False
        land[3, 5] = False
        heights = np.where(land, 700, -10).astype(np.float32)
        terrain = importer.encode_terrain(land, heights, CONFIG)
        self.assertEqual(int(terrain[1, 0]), 32)
        self.assertEqual(int(terrain[3, 5]), 0)
        self.assertEqual(int(terrain[1, 1]), 128 | 64 | 15)
        self.assertEqual(int(terrain[1, 3]), 128 | 15)


if __name__ == "__main__":
    unittest.main()
