# Registered lake surface authoring

The heightmap importer supports opt-in geographic lake polygons independently
of the sea-level mask and satellite color classifier. This reconstructs real
inland water above sea level rather than painting land blue or lowering entire
lakes to the ocean.

## Inputs

Add `lakes` to a map's `import.json`:

```json
{
  "lakes": {
    "source": "lakes.geojson",
    "sourceSha256": "sha256 of the exact checked-out UTF-8/LF bytes",
    "surfaceElevationsMeters": {
      "Lake Superior": 183.2,
      "Lake Michigan": 176.0
    }
  }
}
```

- Use a nonempty GeoJSON FeatureCollection of Polygon or MultiPolygon features,
  with WGS84 longitude/latitude coordinates, closed rings and nonempty
  `properties.name`. Interior rings are island holes; winding does not matter.
- Supply exactly one finite elevation per distinct lake name. Keep the source
  under that map's input directory. Pin its hash and record authoritative source,
  license, vertical datum and selection provenance in its top-level `source`.
- Elevations must be inside the calibrated range and at or above configured sea
  level. Below-sea-level lakes are rejected because the shared renderer currently
  clamps water surfaces to sea level. A future extension must address that
  rendering assumption rather than silently claiming support.
- The current registration uses the same recorded Manticorp Web Mercator export
  footprint as river linework. Polygons crossing the antimeridian must be split
  upstream; this importer does not repair geographic topology.
- A surface is a fixed nominal water level. It is neither bathymetry nor a live
  water-level measurement. Do not flatten a flowing connecting river or rapids
  to one lake's level.

## Bake and runtime contract

1. Decode and majority-resample the unchanged 16-bit calibrated height source.
2. Project original lake rings into the export footprint. Scan-convert at true
   centres of an 8×8 subcell grid per output tile, subtracting holes. Clip all
   sides without wrapping coordinates.
3. Union polygon coverage before deciding water. At least half of the 64 samples
   makes the tile water. Adjacent named polygons must not leave an artificial
   dry seam simply because each covers less than half of a shared tile.
4. Give mixed boundary cells the surface level of the lake with most samples;
   equal counts use original feature-name order. Differing-level polygons that
   overlap at a sampled location are rejected. Per-lake manifest counts report
   this dominant ownership, not overlapping counts.
5. Set the authoritative terrain mask to water and flatten only those lake
   samples to their configured level. Keep every height outside the lake mask
   and every source PNG byte unchanged. Apply existing river masks afterward.
6. Recompute terrain shore/ocean-connectivity flags and baked environment fields.
   Lake cells have no vegetation. The existing runtime decodes their positive
   heights, prevents land walking, permits water paths, and renders water with
   the same shore handling as other water. Relief uses the elevated surface.

Maps without `lakes` retain their previous pipeline. No runtime lake geometry,
new asset encoding, source-color water inference or synthetic albedo is needed.
The manifest records provenance, sampling policy, fixed levels and cell counts
for every variant. Repeating an import is deterministic with pinned dependencies.

## New World source and limits

New World includes the five Great Lakes and Lake Saint Clair, selected unchanged
from [Natural Earth 1:10m lakes, v5.0.0](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-lakes/).
The checked-in source retains 47 island holes and its exact upstream commit/blob
and hash. Natural Earth data are public domain.

The nominal surface levels are NOAA/Canadian Hydrographic Service IGLD1985 chart
or low-water datums: Superior 183.2 m, Michigan/Huron 176.0 m, Saint Clair 174.4 m,
Erie 173.5 m and Ontario 74.2 m. See
[NOAA Great Lakes datums](https://www.tidesandcurrents.noaa.gov/gldatums.html) and
[Canadian Hydrographic Service](https://tides.gc.ca/en/great-lakes-st-lawrence-river-system).
They are not current or average water levels, and no exact vertical-datum
transformation to the source DEM is asserted.

Continental raster sizes cannot retain every inlet, strait or island. Lake Saint
Clair has no independently resolved majority-area surface at size 250, although
existing St. Clair river water remains. Lake interiors are water-path tested,
but this is not an assertion that all lakes or the Atlantic connect at every
size. The supplied lake polygons do not include the Superior–Huron St. Marys
River channel, and original river/outlet gaps remain. No invented connector or
physical-navigation claim is added.

## Tests

```sh
python -m unittest discover -s tests -p '*_test.py'
npm run test:skirmish -- --maxWorkers=4
npm run build:skirmish
```

Authoring regressions cover source validation, projection/clipping, holes,
MultiPolygons, true symmetric subcell sampling, half-cell ties, shared-boundary
coverage, conflicting levels, unchanged outside heights, flat elevated water,
shore bits and cleared vegetation. Runtime regressions cover all map sizes,
intra-lake boat paths, land barriers, calibrated surfaces, tree-free water and
shared rendering. Other map assets are protected by byte-hash comparison.
