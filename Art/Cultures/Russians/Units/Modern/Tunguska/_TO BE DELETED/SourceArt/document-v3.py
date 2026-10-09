from pathlib import Path
p=Path('Art/Cultures/Russians/Units/Modern/Tunguska/README.md')
p.write_text('''# 2K22 Tunguska
The approved strict overhead first idle frame is preserved as Idle-FirstFrame-Nadir-v2.png.

## Animation set v3
Six six-frame sheets: radar idle, tracked movement, paired autocannon fire, missile launch, hit reaction and destruction. Wreck-v3.png exactly matches the final destruction cell.

Built-in ImageGen generated native RGBA sources. Exact prompts, layout corrections and prior outputs are retained in SourceArt. Explicit measured hull roots and one constant per-clip scale register the atlases without per-frame fitting. The radar scans in its roof plane; the final wreck remains settled without flames. Native faint alpha edges and authored firing/damage effects are preserved.

animations.json and Generation.json select the current sources. Animation-v3-Validation.json records bounds/alpha/pivots. Animation-v3-Browser-Review.json confirms all six clips load, all 36 frames render without clipping, idle/movement loop, and one-shot clips hold frame six. No page errors. Local screenshots are Review-Guns-v3.png and Review-Wreck-v3.png.

Local artwork preview is complete; user visual acceptance and gameplay/runtime integration remain separate.
''',encoding='utf-8')

