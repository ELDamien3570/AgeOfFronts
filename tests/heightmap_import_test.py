"""Authoring tests: python -m unittest discover -s tests -p heightmap_import_test.py"""
import importlib.util
from pathlib import Path
import unittest
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import numpy as np
from PIL import Image

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
    def test_geographic_river_bends_are_four_connected_and_do_not_change_heights(self):
        from riverHydrology import river_mask
        document = {"features": [{"geometry": {"type": "LineString", "coordinates": [[-90, 66], [90, -66]]}}]}
        mask = river_mask(document, (0, 0, 1, 1), (50, 50), 2)
        start = tuple(np.argwhere(mask)[0])
        pending, visited = [start], {start}
        while pending:
            y, x = pending.pop()
            for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= yy < 50 and 0 <= xx < 50 and mask[yy, xx] and (yy, xx) not in visited:
                    visited.add((yy, xx))
                    pending.append((yy, xx))
        self.assertEqual(len(visited), int(mask.sum()))
        heights = np.full((50, 50), 900, dtype=np.float32)
        land = ~mask
        terrain = importer.encode_terrain(land, heights, CONFIG)
        self.assertTrue(np.all((terrain[mask] & 128) == 0))
        self.assertTrue(np.all(heights == 900))

    def test_explicit_river_widths_do_not_multiply_with_resolution(self):
        from riverHydrology import river_mask
        document = {"features": [{"geometry": {"type": "LineString", "coordinates": [[-90, 0], [90, 0]]}}]}
        for size, cells in [(250, 1), (500, 2), (1000, 3)]:
            mask = river_mask(document, (0, 0, 1, 1), (size, size), 6, cells)
            self.assertEqual(int(mask[:, size // 2].sum()), cells)
        for invalid in [0, 7, 2.5, True]:
            with self.assertRaisesRegex(ValueError, "explicit river cell width"):
                river_mask(document, (0, 0, 1, 1), (50, 50), 1, invalid)

    def test_per_map_green_sensitivity_gently_increases_vegetation_without_greening_sand_or_water(self):
        colors = np.array([[[120, 123, 80], [200, 165, 100], [35, 80, 125]]], dtype=np.uint8)
        baseline, water = importer.classify_albedo(colors)
        adjusted, adjusted_water = importer.classify_albedo(colors, 1.1)
        self.assertGreater(adjusted[0, 0, 1], baseline[0, 0, 1])
        self.assertLess(adjusted[0, 0, 1] - baseline[0, 0, 1], 0.1)
        self.assertTrue(np.array_equal(adjusted[0, 1:], baseline[0, 1:]))
        self.assertTrue(np.array_equal(water, adjusted_water))
        self.assertTrue(np.array_equal(adjusted[..., 2], baseline[..., 2]))
        self.assertTrue(np.array_equal(importer.classify_albedo(colors, 1.0)[0], baseline))
        for invalid in [0, 3, float('nan')]:
            with self.assertRaisesRegex(ValueError, 'green sensitivity'):
                importer.classify_albedo(colors, invalid)

    def test_color_evidence_is_continuous_and_greener_than_dry_ground(self):
        colors = np.array([[[95, 125, 65], [180, 150, 105], [35, 80, 125]]], dtype=np.uint8)
        fields, water = importer.classify_albedo(colors)
        self.assertGreater(fields[0, 0, 0], fields[0, 1, 0])
        self.assertGreater(fields[0, 0, 1], fields[0, 1, 1])
        self.assertLess(fields[0, 0, 2], fields[0, 1, 2])
        self.assertTrue(water[0, 2])
        self.assertEqual(fields[0, 2, 1], 0)
        gradient = np.array([[[120, green, 70] for green in range(110, 141)]], dtype=np.uint8)
        vegetation = importer.classify_albedo(gradient)[0][0, :, 1]
        self.assertTrue(np.all(np.diff(vegetation) >= 0))
        self.assertLess(np.max(np.diff(vegetation)), 0.05)

    def test_smoothing_blends_land_gradients_without_planting_ocean(self):
        colors = np.zeros((12, 12, 3), dtype=np.uint8)
        colors[:, :6] = [95, 125, 65]
        colors[:, 6:] = [180, 150, 105]
        land = np.ones((12, 12), dtype=bool)
        land[:2] = False
        image = Image.fromarray(colors)
        raw, _ = importer.bake_environment(image, land, 500, 0)
        smooth, _ = importer.bake_environment(image, land, 500, 1.4)
        self.assertTrue(np.all(smooth[~land] == 0))
        self.assertLess(abs(int(smooth[6, 5, 1]) - int(smooth[6, 6, 1])),
                        abs(int(raw[6, 5, 1]) - int(raw[6, 6, 1])))
        self.assertGreater(smooth[6, 2, 1], smooth[6, 9, 1])
        self.assertTrue(np.array_equal(smooth, importer.bake_environment(image, land, 500, 1.4)[0]))

    def test_longest_edge_preserves_square_portrait_and_wide_sources(self):
        self.assertEqual(importer.output_dimensions(4096, 4096, 500), (500, 500))
        self.assertEqual(importer.output_dimensions(8192, 2048, 500), (500, 125))
        self.assertEqual(importer.output_dimensions(6144, 8192, 1000), (750, 1000))
        self.assertEqual(importer.output_dimensions(300, 400, 250), (188, 250))

    def test_square_resampling_keeps_both_edges_and_calibrated_shores(self):
        source = np.full((500, 500), 15000, dtype=np.uint16)
        source[:, :100] = 0
        source[-100:, :] = 0
        land, heights, _ = importer.resample(source, 250, CONFIG)
        self.assertEqual(land.shape, (250, 250))
        self.assertFalse(land[10, 10])
        self.assertTrue(land[10, 200])
        self.assertFalse(land[240, 200])
        self.assertTrue(np.all(heights[land] > 0))
        self.assertTrue(np.all(heights[~land] <= 0))

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
