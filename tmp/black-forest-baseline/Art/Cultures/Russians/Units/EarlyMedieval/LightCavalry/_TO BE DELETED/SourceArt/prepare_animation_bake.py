from pathlib import Path
import json
from PIL import Image

p=Path(__file__).parent
root=p.parent
prior=root.parent.parent/'ClassicalAge/LightCavalry/SourceArt/compose_animations.py'
code=prior.read_text(encoding='utf-8').replace('Classical Iron Light Cavalry','Early Medieval Rus Light Cavalry')
code=code.replace("if not backup.exists(): shutil.copy2(ROOT/name,backup)","if not backup.exists() and (ROOT/name).exists(): shutil.copy2(ROOT/name,backup)")
code=code.replace("order=[0,1,3,2,4,5] if ident=='attack' else list(range(6))","order=record.get('sourceFrameOrder',list(range(6)))")
code=code.replace('One iron rider. One idle frame.','One Rus lancer. One idle frame.').replace('One iron rider. Nine motions.','One Rus lancer. Nine motions.').replace('Loading Classical cavalry idle design','Loading lancer idle')
code=code.replace("im=Image.open(native).convert('RGBA');assert im.size==(1536,1024)","im=Image.open(native);assert im.mode=='RGBA' and im.size==(1536,1024)")
code=code.replace('Horse breathes and settles while the rider holds an iron-tipped spear.','Horse breathes and settles while the lancer holds lance and shield.')
(p/'compose_animations.py').write_text(code,encoding='utf-8')
jobs=[];cuts={}
for ident in ['idle','running','attack','hit','charged','charge','charge-attack','death','death-thrown']:
 rec_path=max(p.glob('Generation-'+ident+'-v*.json'),key=lambda f:int(f.stem.rsplit('-v',1)[1]))
 rec=json.loads(rec_path.read_text(encoding='utf-8'))
 a=Image.open(rec['generatedSource']).getchannel('A')
 assert a.size==(1536,1024),(ident,a.size)
 found=[]
 for col in range(3):
  candidates=[]
  for y in range(490,531):
   vals=list(a.crop((col*512,y,col*512+512,y+1)).get_flattened_data())
   candidates.append((sum(v>16 for v in vals),abs(y-512),y))
  best=min(candidates)
  assert best[0]==0,(ident,col,'no transparent row gutter',best)
  found.append(best[2])
 jobs.append({'id':ident,'file':rec['file']});cuts[ident]=found
 print(ident,found)
(p/'Animation-Plan.json').write_text(json.dumps({'date':'2026-10-07','mode':'built-in-imagegen','approvedDesign':'Idle-v1.png','jobs':jobs,'sourceRowCuts':cuts},indent=2)+'\n',encoding='utf-8')
