from pathlib import Path
p=Path('Art/Cultures/Russians/Units/BronzeAge/BronzeAxeman/README.md')
s=p.read_text(encoding='utf-8')
s+='\n\n## Heavy mace strikes - v6\n\nAttack and charge attack now use BronzeMace-Heavy-v6 sheets. A compact coil precedes a planted cross-body strike with visible whole-body rotation and an extended opposite-side follow-through. Timing holds the coil and drives rapidly through impact. Exact built-in ImageGen prompts, original sheets, native alpha, fixed scales, authored roots and preview guard adjustments are preserved in SourceArt. Mace-Heavy-v6-Browser-Review.json verifies twelve revised frames without clipping or page errors and both attacks hold their last frame. User visual acceptance remains pending.\n'
p.write_text(s,encoding='utf-8')

