# Old World map review

Old World now uses the replacement export supplied in `HeightMaps/Old World`.
The stable `old-world` identity is retained for existing links and room settings.
No importer algorithm, domain ownership or terrain-renderer changes were needed.

## Updated source and footprint

- Height source: `15_623_69_961_5_4096_3072_16bit.png`, true 16-bit grayscale
- Source dimensions: 4096 × 3072; original PNG bytes preserved
- Supplied Regular calibration: −450 to 7188 m, range 65536, sea level 0
- Shared movement thresholds: highland 600 m, mountain 1800 m
- Web Mercator extent: 20.039075° W–159.960925° E, 45.828810° S–63.704715° N
- Gameplay variants: 250 × 188, 500 × 375, 1000 × 750
- Exact source URL and PNG hashes are pinned in `import.json`

The center, footprint, resolution and calibration replace the previous
8192 × 6144 export. Saved map settings retain the identity but load revised terrain.

## Biomes and hydrology

Matching satellite imagery now supplies continuous moisture, vegetation and
aridity fields, with land-weighted smoothing 1.4 and green sensitivity 1.1.
The former authored climate patches are no longer referenced by the import;
`climate.json` remains historical source material. OTM labels and roads do not
enter biome fields. Calibrated elevations control mountain tiers and passability.

The separate `snow-climate.json` now raises the Himalayan/Tibetan core snowline
to 5700 m with a soft geographic transition to the previous baseline. This exposes
plateau rock and retains summit snow. Other regions, terrain, water and baked
biome inputs remain unchanged; see the combined review for validation.

The 109 reviewed river features, provenance, Congo coastal extension and
Ganges-Brahmaputra delta are retained and reprojected against the new footprint.
The existing one-/two-/three-cell gameplay widths at 250/500/1000 preserve river
heights, block land movement and clear vegetation from water.

Six registered Natural Earth lakes use independently referenced nominal levels:
Victoria 1134 m, Tanganyika 773 m, Malawi 474 m, Baikal 455.5 m, Van 1649 m,
and Danau Toba 905 m. References and dataset hashes are recorded in
`lakes.geojson` and the manifest. Only lake-mask elevations change; every other
resampled height reproduces the calibrated source bake exactly. These reference
levels are not current measurements or a vertical-datum certification.

## Verification and limits

See [the combined review](RegionalMapImportsReview.md) for evidence, lake references,
and the two new maps. Old World's regressions pass for twenty faction starts,
a dry Sahara versus humid Congo, and Congo/Ganges/Brahmaputra ocean connectivity
at every size. The source coastline overlay, runtime-derived preview and live
500-size game rendering were inspected, with no reported browser console errors.

Small lakes and straits remain resolution limited. Toba has zero majority cells
at sizes 250 and 500. Arctic river mouths are cropped. No invented connectors are
added. Negative inland lake surfaces remain unsupported by the shared renderer;
the Caspian and other negative basins retain the source sea-threshold behavior.
Final gameplay/art acceptance remains a user review.

## Reproduce

```sh
python scripts/importSkirmishHeightmap.py "HeightMaps/Old World/import.json"
node scripts/generateLobbyMapPreview.mjs old-world
node node_modules/vitest/vitest.mjs run --config vite.skirmish.config.ts --maxWorkers=2
node node_modules/vite/bin/vite.js build --config vite.skirmish.config.ts
```

Local route: `/skirmish/index.html?map=old-world`. The original review was local.
The [combined map review](RegionalMapImportsReview.md#workspace-integration-3-october-2026)
records subsequent workspace integration and current multiplayer validation.
