from pathlib import Path
root=Path('Art/Cultures/Russians/Units/BronzeAge/BronzeAxeman')
p=root/'SourceArt'/'register-full-mace-v4.py'
s=p.read_text(encoding='utf-8-sig')
s=s.replace("clip.pop('axeOrientation',None)","if clip['id']=='charge-attack':\n  for i,y in [(2,273.5),(3,210.5),(4,210.5)]:clip['frames'][i]['pivot']['y']=y\n clip.pop('axeOrientation',None)")
p.write_text(s,encoding='utf-8')
p=root/'SourceArt'/'refine-mace-v4-roots.py';s=p.read_text(encoding='utf-8-sig').replace("for i,dy in [(2,-12),(3,16),(4,16)]:","for i,targetY in [(2,273.5),(3,210.5),(4,210.5)]:").replace("clip['frames'][i]['pivot']['y']+=dy","clip['frames'][i]['pivot']['y']=targetY")
p.write_text(s,encoding='utf-8')
readme=root/'README.md';s=readme.read_text(encoding='utf-8-sig')
s+='\n\n## Overhead bronze mace set - 2026-10-07\n\nThe approved mace idle is retained as v3. All remaining eight motions now select versioned `*-BronzeMace-Nadir-v4.png` sheets: running, charge, light hit, charged reaction, attack, charge attack, side death and backward death. The unit folder and gameplay identity remain BronzeAxeman. The artwork uses the bronze mace throughout and a vertical overhead camera. Attacks coil the shoulders and body; grounded poses use smaller helmets and flat corpse silhouettes. Final corpse cells are exported as `Corpse-Prone-BronzeMace-v4.png` and `Corpse-Back-BronzeMace-v4.png`.\n\nBuilt-in ImageGen created the native RGBA sheets. Exact generation and correction prompts, earlier sheets, manual dome measurements, explicit pivots, constant per-clip scales and guard checks are retained in SourceArt. No per-frame scale fitting or alpha thresholding was applied. Old axe sheets and records are retained. `Generation.json` selects the current sources.\n\n`Mace-Full-v4-Browser-Review.json` confirms all nine sheets load, all 54 frames render without clipping, running/charge loop, both deaths hold frame six, and no page errors occur. Two review screenshots are saved. This is local art-preview validation; match integration and user visual acceptance remain pending.\n'
readme.write_text(s,encoding='utf-8')

