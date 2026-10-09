# 2K22 Tunguska
The approved strict overhead first idle frame is preserved as Idle-FirstFrame-Nadir-v2.png.

## Animation set v3
Six six-frame sheets: radar idle, tracked movement, paired autocannon fire, missile launch, hit reaction and destruction. Wreck-v3.png exactly matches the final destruction cell.

Built-in ImageGen generated native RGBA sources. Exact prompts, layout corrections and prior outputs are retained in SourceArt. Explicit measured hull roots and one constant per-clip scale register the atlases without per-frame fitting. The radar scans in its roof plane; the final wreck remains settled without flames. Native faint alpha edges and authored firing/damage effects are preserved.

animations.json and Generation.json select the current sources. Animation-v3-Validation.json records bounds/alpha/pivots. Animation-v3-Browser-Review.json confirms all six clips load, all 36 frames render without clipping, idle/movement loop, and one-shot clips hold frame six. No page errors. Local screenshots are Review-Guns-v3.png and Review-Wreck-v3.png.

Local artwork preview is complete; user visual acceptance and gameplay/runtime integration remain separate.

Hull registration v4 measures track-defined hull width and length, excluding radar, guns and effects. Every clip uses fixed X/Y calibration to230 by340 units and explicit hull-center pivots. This corrects inconsistent generator proportions across sheets without frame-by-frame fitting or native image changes. The vehicle-specific review renderer is local to this folder. Registered hull lengths are within338.28 to341.09 units across all36frames; widths224.99 to234.24. Prior metadata is archived inSourceArt/Before-Hull-Registration-v4. Hull-Size-v4-Browser-Review.json records final browser verification.
