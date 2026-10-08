from pathlib import Path
import json,shutil,numpy as np
root=Path('Art/Cultures/Russians/Units/Modern/Tunguska')
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
backup=root/'SourceArt'/'Before-Hull-Registration-v4';backup.mkdir(exist_ok=True)
for f in ['animations.json','Actor_Review.html']:
 if not (backup/f).exists():shutil.copy2(root/f,backup/f)
measure=read(root/'SourceArt'/'Hull-Measurements-v4.json')
d=read(root/'animations.json');report={}
for c in d['animations']:
 bounds=measure[c['id']]
 widths=[b[2]-b[0] for b in bounds];heights=[b[3]-b[1] for b in bounds]
 sx=230/float(np.median(widths));sy=340/float(np.median(heights))
 c.update(scale=1,scaleX=round(sx,7),scaleY=round(sy,7))
 for f,b in zip(c['frames'],bounds):f['pivot']={'x':(b[0]+b[2])/2,'y':(b[1]+b[3])/2}
 report[c['id']]={'sourceHullBounds':bounds,'scaleX':sx,'scaleY':sy,'registeredWidths':[round(w*sx,2) for w in widths],'registeredLengths':[round(h*sy,2) for h in heights]}
d['artRevision']='tunguska-hull-size-v4'
d['registration']='Track-defined hull centers; fixed per-clip X/Y calibration to a 230 by 340 unit hull. Radar, weapons and effects excluded. No per-frame scale fitting.'
(root/'animations.json').write_text(json.dumps(d,indent=2),encoding='utf-8')
(root/'SourceArt'/'Hull-Registration-v4.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
# Keep the vehicle-specific geometry registration local to this preview.
js=Path('Art/Cultures/Russians/Units/StoneAge/Clubman/actor-review.js').read_text(encoding='utf-8')
js=js.replace('const scale = footprint / frame.width * clip.scale;','const scale = footprint / frame.width * clip.scale;\n    const scaleX = scale * (clip.scaleX || 1);\n    const scaleY = scale * (clip.scaleY || 1);')
js=js.replace('-frame.pivot.x * scale, -frame.pivot.y * scale,','-frame.pivot.x * scaleX, -frame.pivot.y * scaleY,').replace('frame.width * scale, frame.height * scale);','frame.width * scaleX, frame.height * scaleY);').replace('one soldier','one vehicle')
(root/'vehicle-review.js').write_text(js,encoding='utf-8')
p=root/'Actor_Review.html';html=p.read_text(encoding='utf-8').replace('../../StoneAge/Clubman/actor-review.js?revision=tunguska-animations-v3','vehicle-review.js?revision=tunguska-hull-size-v4').replace('Animations v3','Hull size v4')
p.write_text(html,encoding='utf-8')
print(json.dumps({k:{'widthRange':[min(v['registeredWidths']),max(v['registeredWidths'])],'lengthRange':[min(v['registeredLengths']),max(v['registeredLengths'])]} for k,v in report.items()}))

