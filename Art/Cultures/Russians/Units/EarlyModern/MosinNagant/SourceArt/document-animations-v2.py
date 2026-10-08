from pathlib import Path
p=Path('Art/Cultures/Russians/Units/EarlyModern/MosinNagant/README.md')
p.write_text('''# Russian Mosin-Nagant infantry
Soviet khaki uniform and steel helmet selected by the user. Stored in EarlyModern at the user's request. The approved first idle frame is preserved.

## Animation set v2
Ten six-frame overhead sheets: idle, running, charge, firing, advancing shot, bolt/stripper reload, light hit, charged reaction, side death and backward fall. Native RGBA and exact built-in ImageGen prompts/corrections are retained in SourceArt. Explicit authored pivots and one constant scale per clip register the soldier without per-frame bounds fitting. Grounded bodies are intentionally smaller; backward corpse boots show their uppers, and the weapon settles beside the body.

animations.json and Generation.json select the current sources. Corpse-Prone-v2.png and Corpse-Back-v2.png exactly match the final cells.

Animation-v2-Validation.json records native dimensions, guards, alpha checks and preview roots. Animation-v2-Browser-Review.json confirms all ten sheets load, all 60 frames are visible/unclipped, idle/running/charge loop, and reload/deaths hold frame six. No page errors. Review-Firing-v2.png and Review-Corpse-v2.png show the local review result.

This completes the local art preview. Visual acceptance and match integration remain separate. Existing musketeer art and gameplay were not changed.
''',encoding='utf-8')

