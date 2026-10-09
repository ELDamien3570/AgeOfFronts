from pathlib import Path
import json,shutil,hashlib
from PIL import Image,ImageFilter
import numpy as np
root=Path(__file__).resolve().parent.parent
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
backup=root/'SourceArt'/'Before-Compact-Windups-v5'
backup.mkdir(exist_ok=True)
for name in ['animations.json','Generation.json','Actor_Review.html']:
 if not (backup/name).exists():shutil.copy2(root/name,backup/name)
data=read(root/'animations.json')
registrations={}
for name in ['Strikes','Charge']:
 record=read(root/'SourceArt'/f'{name}-BronzeMace-Compact-v5-Registration.json')
 registrations.update({k:v for k,v in record.items() if k in ['attack','charge','charge-attack']})
checks={}
for clip in data['animations']:
 if clip['id'] not in registrations:continue
 reg=registrations[clip['id']];file=reg['file']
 im=Image.open(root/file);assert im.size==(1536,1024) and im.mode=='RGBA'
 arr=np.array(im);frames=[]
 for i in range(6):
  alpha=arr[i//3*512:i//3*512+512,i%3*512:i%3*512+512,3]
  yy,xx=np.where(alpha>16);bounds=[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)]
  assert min(bounds[0],bounds[1],512-bounds[2],512-bounds[3])>=8,(file,i,bounds)
  dil=np.array(Image.fromarray((alpha>128).astype('uint8')*255).filter(ImageFilter.MaxFilter(7)))>0
  frames.append({'frame':i,'bounds':bounds,'maximumAlphaBeyond3px':int(alpha[~dil].max()),'pixelsAbove16Beyond3px':int((alpha[~dil]>16).sum())})
 clip.update(file=file,sha256=hashlib.sha256((root/file).read_bytes()).hexdigest(),scale=reg['scale'])
 for i,frame in enumerate(clip['frames']):frame['pivot']=reg['pivots'][i]
 clip['description']= {'charge':'Shield-led sprint with a compact mace guard close to the shoulder.','attack':'Compact shoulder windup, body rotation and a forceful mace swing.','charge-attack':'Plant the lead foot, coil the body with the mace close to the shoulder and strike.'}[clip['id']]
 checks[clip['id']]={'file':file,'scale':clip['scale'],'frames':frames}
data['artRevision']='bronze-mace-compact-v5'
data['artRevisions'].append({'date':'2026-10-07','clips':list(registrations),'reason':'User feedback: weapon arm reached too far back. Shortened shoulder windups, preserved body coil.','userApproval':'pending compact windup review'})
(root/'animations.json').write_text(json.dumps(data,indent=2),encoding='utf-8')
g=read(root/'Generation.json')
for clip in data['animations']:g['selectedFiles'][clip['id']]=clip['file']
for p in (root/'SourceArt').glob('*BronzeMace-Compact-v5-Generation.json'):g['records'].append(read(p))
(root/'Generation.json').write_text(json.dumps(g,indent=2),encoding='utf-8')
(root/'SourceArt'/'Compact-Windups-v5-Checks.json').write_text(json.dumps(checks,indent=2),encoding='utf-8')
p=root/'Actor_Review.html';s=p.read_text(encoding='utf-8').replace('Mace full v4','Compact windups v5').replace('revision=bronze-mace-full-v4','revision=bronze-mace-compact-v5')
p.write_text(s,encoding='utf-8')
print(json.dumps({k:v['file'] for k,v in checks.items()}))


