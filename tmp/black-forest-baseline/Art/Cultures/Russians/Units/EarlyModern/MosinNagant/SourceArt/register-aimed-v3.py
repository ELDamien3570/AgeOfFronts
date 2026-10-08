from pathlib import Path
import json,hashlib,shutil
from PIL import Image,ImageFilter
import numpy as np
root=Path(__file__).resolve().parent.parent
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
backup=root/'SourceArt'/'Before-Aimed-Fire-v3';backup.mkdir(exist_ok=True)
for f in ['animations.json','Generation.json','Actor_Review.html']:
 if not (backup/f).exists():shutil.copy2(root/f,backup/f)
reg=read(root/'SourceArt'/'Aimed-v3-Registration.json');d=read(root/'animations.json');report={}
for c in d['animations']:
 if c['id'] not in reg:continue
 r=reg[c['id']];im=Image.open(root/r['file']);assert im.size==(1536,1024) and im.mode=='RGBA'
 a=np.array(im);frames=[];scale=r['scale'];s=420/512*scale
 for i,frame in enumerate(c['frames']):
  alpha=a[i//3*512:i//3*512+512,i%3*512:i%3*512+512,3];yy,xx=np.where(alpha>16)
  bounds=[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)]
  assert min(bounds[0],bounds[1],512-bounds[2],512-bounds[3])>=8,(c['id'],i,bounds)
  pivot=dict(r['pivots'][i])
  for axis,lo,hi in [('x',bounds[0],bounds[2]),('y',bounds[1],bounds[3])]:
   lower=hi-248/s;upper=lo+248/s
   assert lower<=upper,(c['id'],i,'preview extent too wide')
   pivot[axis]=round(min(max(pivot[axis],lower),upper),2)
  frame['pivot']=pivot
  dil=np.array(Image.fromarray((alpha>128).astype('uint8')*255).filter(ImageFilter.MaxFilter(7)))>0
  frames.append({'frame':i,'bounds':bounds,'authoredPivot':r['pivots'][i],'previewPivot':pivot,'maxAlphaBeyond3px':int(alpha[~dil].max()),'pixelsAbove16Beyond3px':int((alpha[~dil]>16).sum()),'muzzleFlashFrame':i==3})
 order=r.get('sourceOrder',list(range(6)))
 sourceFrames=list(c['frames'])
 c['frames']=[dict(sourceFrames[source],index=i,sourceIndex=source) for i,source in enumerate(order)]
 c['sourceFrameOrder']=order
 c.update(file=r['file'],scale=scale,sha256=hashlib.sha256((root/r['file']).read_bytes()).hexdigest(),impactFrame=3,durations=[130,160,260,70,160,220])
 c['description']='Turn the hips and shoulders into a bladed stance, shoulder the rifle and aim forward before firing.' if c['id']=='attack' else 'Advance, plant the lead foot, turn into a bladed stance and shoulder the rifle to shoot forward.'
 report[c['id']]={'file':r['file'],'scale':scale,'frames':frames}
d['artRevision']='mosin-aimed-fire-v3'
d.setdefault('artRevisions',[]).append({'date':'2026-10-07','clips':['attack','charge-attack'],'reason':'User rejected side-held firing. Both attacks now turn the body, shoulder the rifle and aim along screen-down facing before firing.','userApproval':'pending aimed firing review'})
(root/'animations.json').write_text(json.dumps(d,indent=2),encoding='utf-8')
g=read(root/'Generation.json')
for c in d['animations']:g['selectedFiles'][c['id']]=c['file']
for p in (root/'SourceArt').glob('*Aimed-v3-Generation.json'):
 record=read(p)
 if record not in g['records']:g['records'].append(record)
(root/'Generation.json').write_text(json.dumps(g,indent=2),encoding='utf-8')
(root/'Aimed-v3-Validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
p=root/'Actor_Review.html';s=p.read_text(encoding='utf-8').replace('Animations v2','Aimed fire v3').replace('revision=mosin-animations-v2','revision=mosin-aimed-fire-v3')
p.write_text(s,encoding='utf-8')
print(json.dumps({c['id']:c['file'] for c in d['animations'] if c['id'] in reg}))

