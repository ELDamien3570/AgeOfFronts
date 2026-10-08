from pathlib import Path
from PIL import Image
import json

p=Path(__file__).parent
root=p.parent
code=(root.parent/'LightCavalry/SourceArt/compose_animations.py').read_text(encoding='utf-8')
code=code.replace('Early Medieval Rus Light Cavalry','Early Medieval Druzhina')
code=code.replace("ROOT/'Idle-v1.png'","ROOT/'Idle-v3.png'").replace("{'file':'Idle-v1.png'","{'file':'Idle-v3.png'")
code=code.replace("ident=job['id'];record_path=SOURCE/('Generation-'+ident+'-v2.json')\n    if not record_path.exists(): record_path=SOURCE/('Generation-'+ident+'-v1.json')","ident=job['id'];record_path=max([f for f in SOURCE.glob('Generation-'+ident+'-v*.json') if json.loads(f.read_text(encoding='utf-8')).get('id')==ident],key=lambda f:int(f.stem.rsplit('-v',1)[1]))")
code=code.replace('One Rus lancer. One idle frame.','One Druzhina. One idle frame.').replace('One Rus lancer. Nine motions.','One Druzhina. Nine motions.').replace('Loading lancer idle','Loading Druzhina idle')
code=code.replace('Horse breathes and settles while the lancer holds lance and shield.','Armored horse breathes and settles; Druzhina carries the lance point-up at rest.')
code=code.replace('Loading nine light cavalry sprite sheets','Loading nine Druzhina sprite sheets')
code=code.replace("    records.append({**record", "    if original['generatedSource'] != record['generatedSource']:\n        records.append({**original,'status':'superseded-animation-draft','nativeCopy':str(original_copy.relative_to(ROOT)).replace('\\\\','/')})\n    records.append({**record")
code=code.replace("generation['records'][0]['status']='approved-design-reference';write(ROOT/'Generation.json',generation)","\nfor entry in generation['records']:\n    if entry.get('file')=='Idle-v3.png': entry['status']='approved-design-reference'\nwrite(ROOT/'Generation.json',generation)")
(p/'compose_animations.py').write_text(code,encoding='utf-8')
jobs=[];cuts={}
for ident in ['idle','running','attack','hit','charged','charge','charge-attack','death','death-thrown']:
 records=[f for f in p.glob('Generation-'+ident+'-v*.json') if json.loads(f.read_text(encoding='utf-8')).get('id')==ident]
 rec=json.loads(max(records,key=lambda f:int(f.stem.rsplit('-v',1)[1])).read_text(encoding='utf-8'))
 im=Image.open(rec['generatedSource']);assert im.mode=='RGBA' and im.size==(1536,1024),(ident,im.mode,im.size)
 a=im.getchannel('A');found=[]
 for col in range(3):
  candidates=[]
  for y in range(490,531):
   vals=list(a.crop((col*512,y,col*512+512,y+1)).get_flattened_data())
   candidates.append((sum(v>16 for v in vals),abs(y-512),y))
  best=min(candidates);assert best[0]==0,(ident,col,'no transparent row gutter',best)
  found.append(best[2])
 cuts[ident]=found;jobs.append({'id':ident,'file':rec['file']});print(ident,found)
(p/'Animation-Plan.json').write_text(json.dumps({'date':'2026-10-07','mode':'built-in-imagegen','approvedDesign':'Idle-v3.png','jobs':jobs,'sourceRowCuts':cuts},indent=2)+'\n',encoding='utf-8')
