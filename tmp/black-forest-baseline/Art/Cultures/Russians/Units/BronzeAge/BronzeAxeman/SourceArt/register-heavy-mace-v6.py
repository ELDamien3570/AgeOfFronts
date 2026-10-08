from pathlib import Path
import json,hashlib,shutil
from PIL import Image,ImageFilter
import numpy as np
root=Path(__file__).resolve().parent.parent
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
backup=root/'SourceArt'/'Before-Heavy-Strikes-v6';backup.mkdir(exist_ok=True)
for f in ['animations.json','Generation.json','Actor_Review.html']:
 if not (backup/f).exists():shutil.copy2(root/f,backup/f)
reg=read(root/'SourceArt'/'Strikes-BronzeMace-Heavy-v6-Registration.json')
data=read(root/'animations.json');report={}
for clip in data['animations']:
 if clip['id'] not in reg:continue
 r=reg[clip['id']];name=r['file'];im=Image.open(root/name)
 assert im.size==(1536,1024) and im.mode=='RGBA'
 a=np.array(im);checks=[]
 scale=r['scale'];s=420/512*scale
 for i,frame in enumerate(clip['frames']):
  alpha=a[i//3*512:i//3*512+512,i%3*512:i%3*512+512,3]
  yy,xx=np.where(alpha>16);bounds=[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)]
  assert min(bounds[0],bounds[1],512-bounds[2],512-bounds[3])>=8,(name,i,bounds)
  pivot=dict(r['pivots'][i])
  for axis,lo,hi in [('x',bounds[0],bounds[2]),('y',bounds[1],bounds[3])]:
   lower=hi-248/s;upper=lo+248/s
   assert lower<=upper,(name,i,'footprint too large')
   pivot[axis]=round(min(max(pivot[axis],lower),upper),2)
  frame['pivot']=pivot
  dil=np.array(Image.fromarray((alpha>128).astype('uint8')*255).filter(ImageFilter.MaxFilter(7)))>0
  checks.append({'frame':i,'bounds':bounds,'authoredPivot':r['pivots'][i],'previewPivot':pivot,'maxAlphaBeyond3px':int(alpha[~dil].max()),'pixelsAbove16Beyond3px':int((alpha[~dil]>16).sum())})
 clip.update(file=name,scale=scale,sha256=hashlib.sha256((root/name).read_bytes()).hexdigest(),impactFrame=3,durations=[120,180,180,80,150,220])
 clip['description']='Plant, coil the hips and shoulders, drive the mace across the front and commit to the follow-through.' if clip['id']=='attack' else 'Plant the lead foot from the charge, rotate the whole body and drive a heavy mace sweep across the front.'
 report[clip['id']]={'file':name,'scale':scale,'frames':checks}
data['artRevision']='bronze-mace-heavy-v6'
data['artRevisions'].append({'date':'2026-10-07','clips':['attack','charge-attack'],'reason':'User requested a heavier human swing. Planted stance, stronger body rotation, fast cross-body strike and committed follow-through. Compact windup retained.','userApproval':'pending heavy strike review'})
(root/'animations.json').write_text(json.dumps(data,indent=2),encoding='utf-8')
g=read(root/'Generation.json')
for c in data['animations']:g['selectedFiles'][c['id']]=c['file']
for p in (root/'SourceArt').glob('*BronzeMace-Heavy-v6-Generation.json'):g['records'].append(read(p))
(root/'Generation.json').write_text(json.dumps(g,indent=2),encoding='utf-8')
(root/'SourceArt'/'Heavy-Strikes-v6-Checks.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
p=root/'Actor_Review.html';s=p.read_text(encoding='utf-8').replace('Compact windups v5','Heavy strikes v6').replace('revision=bronze-mace-compact-v5','revision=bronze-mace-heavy-v6')
p.write_text(s,encoding='utf-8')
print(json.dumps({k:{'file':v['file'],'scale':v['scale']} for k,v in report.items()}))

