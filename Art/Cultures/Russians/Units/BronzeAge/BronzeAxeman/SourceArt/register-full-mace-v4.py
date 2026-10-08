from pathlib import Path
from PIL import Image,ImageFilter
import numpy as np,json,hashlib,shutil
root=Path(__file__).resolve().parent.parent
backup=root/'SourceArt'/'Before-Mace-Full-v4'
backup.mkdir(exist_ok=True)
for name in ['animations.json','Generation.json','Actor_Review.html']:
 if not (backup/name).exists(): shutil.copy2(root/name,backup/name)
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
data=read(root/'animations.json')
reg={}
for fname in ['Movement','Reactions']:
 for file,v in read(root/'SourceArt'/f'{fname}-BronzeMace-Nadir-v4-Registration.json')['clips'].items():
  reg[file]=(v['fixedScale'],v['pivots'])
for v in read(root/'SourceArt'/'Strikes-BronzeMace-Nadir-v4-Measurements.json').values():
 if isinstance(v,dict) and 'file' in v:
  reg[v['file']]=(v['suggestedScale'],[{'x':x,'y':y+20} for x,y in v['domeCenters']])
for v in read(root/'SourceArt'/'Deaths-BronzeMace-Nadir-v4-Registration.json')['sheets']:
 reg[v['file']]=(v['scaleTo110px'],v['pivots'])
names={'running':'Running','charge':'Charge','hit':'Hit','charged':'Charged','attack':'Attack','charge-attack':'ChargeAttack','death':'Death','death-back':'Death-Back'}
descriptions={'running':'Overhead alternating stride with mace and shield held steady.','charge':'Shield-led sprint with the bronze mace cocked for impact.','hit':'Light impact recoil through the shoulders, step back and recover.','charged':'Brace the shield, absorb a heavy impact, crouch and regain balance.','attack':'Coil the hips and shoulders, swing the bronze mace and recover.','charge-attack':'Deep windup, planted lead foot and a forceful body-driven mace strike.','death':'Knees buckle, collapse sideways and settle into a smaller prone corpse.','death-back':'Fall backward away from the facing direction and settle flat face-up, head toward screen-top.'}
report={}
for clip in data['animations']:
 if clip['id']=='idle':continue
 file=names[clip['id']]+'-BronzeMace-Nadir-v4.png'
 scale,pivots=reg[file]
 image=Image.open(root/file)
 assert image.size==(1536,1024) and image.mode=='RGBA'
 arr=np.array(image); checks=[]
 for i in range(6):
  alpha=arr[i//3*512:i//3*512+512,i%3*512:i%3*512+512,3]
  yy,xx=np.where(alpha>16)
  bounds=[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)]
  assert min(bounds[0],bounds[1],512-bounds[2],512-bounds[3])>=4,(file,i,bounds)
  mask=np.array(Image.fromarray((alpha>128).astype('uint8')*255).filter(ImageFilter.MaxFilter(7)))>0
  outside=alpha[~mask]
  checks.append({'frame':i,'bounds':bounds,'maximumAlphaBeyond3px':int(outside.max()),'pixelsAbove16Beyond3px':int((outside>16).sum())})
 clip.update(file=file,sha256=hashlib.sha256((root/file).read_bytes()).hexdigest(),scale=round(scale,6),weapon='Bronze mace',description=descriptions[clip['id']],sourceFrameOrder=list(range(6)))
 clip['frames']=[{'index':i,'sourceIndex':i,'x':i%3*512,'y':i//3*512,'width':512,'height':512,'pivot':pivots[i]} for i in range(6)]
 if clip['id']=='charge-attack':
  for i,y in [(2,273.5),(3,210.5),(4,210.5)]:clip['frames'][i]['pivot']['y']=y
 clip.pop('axeOrientation',None)
 if clip['id']=='attack':clip['label']='Mace swing'
 if clip['id']=='running':clip['label']='Run'
 if clip['id'] in ['attack','charge-attack']:clip['impactFrame']=3
 if clip['id'].startswith('death'):
  clip['corpseFile']='Corpse-'+('Back' if clip['id']=='death-back' else 'Prone')+'-BronzeMace-v4.png'
 report[clip['id']]={'file':file,'fixedScale':clip['scale'],'frames':checks}
data.update(weapon='Bronze mace',artRevision='bronze-mace-full-v4',integrationStatus='Nine overhead bronze-mace clips ready for visual review; match integration pending.',equipmentFinish='Stylized bronze domed helmet and shoulder caps, cream fur collar, reddish-brown leather, timber shield and rounded lobed bronze mace.')
data['artRevisions'].append({'date':'2026-10-07','clips':list(names),'reason':'Rebuild remaining motions from approved overhead bronze mace idle.','userApproval':'pending full motion review'})
(root/'animations.json').write_text(json.dumps(data,indent=2),encoding='utf-8')
generation=read(root/'Generation.json')
for clip in data['animations']:generation['selectedFiles'][clip['id']]=clip['file']
for p in root.glob('SourceArt/*-BronzeMace-Nadir-v4-Generation.json'):
 generation['records'].append(read(p))
(root/'Generation.json').write_text(json.dumps(generation,indent=2),encoding='utf-8')
(root/'SourceArt'/'Full-Mace-v4-Validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
html=(root/'Actor_Review.html').read_text(encoding='utf-8-sig').replace('Russian Bronze Axeman · Single Actor Review','Russian Bronze Mace · Single Actor Review').replace('Bronze mace idle review.','Bronze mace animation review.').replace('New overhead mace idle; other motion tabs retain the previous axe artwork.','Nine overhead motions with the bronze mace, including both settled corpse poses.').replace('Mace idle v3','Mace full v4').replace('single bronze axeman','single bronze mace warrior').replace('revision=mace-idle-v3','revision=bronze-mace-full-v4')
(root/'Actor_Review.html').write_text(html,encoding='utf-8')
print(json.dumps({k:{'file':v['file'],'fixedScale':v['fixedScale']} for k,v in report.items()},indent=2))

