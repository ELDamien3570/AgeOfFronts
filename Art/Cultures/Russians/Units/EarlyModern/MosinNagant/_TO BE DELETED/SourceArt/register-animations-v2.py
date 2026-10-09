from pathlib import Path
import json,hashlib,shutil
from PIL import Image,ImageFilter
import numpy as np
root=Path(__file__).resolve().parent.parent
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
backup=root/'SourceArt'/'Before-Animation-v2';backup.mkdir(exist_ok=True)
for f in ['animations.json','Generation.json','Actor_Review.html','Validation.json','Browser-Review.json']:
 if not (backup/f).exists():shutil.copy2(root/f,backup/f)
reg={}
for name in ['Movement','Firearm','Deaths','Reactions']:reg.update(read(root/'SourceArt'/f'{name}-v2-Registration.json'))
order=['idle','running','attack','reload','hit','charged','charge','charge-attack','death','death-back']
labels={'idle':'Idle','running':'Run','attack':'Fire Mosin','reload':'Bolt and reload','hit':'Get hit','charged':'Get charged','charge':'Charge in / maintain','charge-attack':'Advance, plant and shoot','death':'Death - side fall','death-back':'Death - back fall'}
descs={'idle':'Subtle breathing with a steady two-handed rifle grip.','running':'Alternating stride with the rifle held in both hands.','attack':'Raise and brace the rifle, fire, absorb recoil and settle.','reload':'Lift and pull the bolt, feed rounds into the receiver, then close and lock the bolt.','hit':'Light shoulder recoil, step back and recover.','charged':'Absorb a heavy impact, stagger and regain balance.','charge':'Lean into a faster stride with the rifle ready.','charge-attack':'Advance, plant the lead foot and fire the rifle.','death':'Buckle, collapse sideways and settle into a smaller prone corpse.','death-back':'Fall backward and settle flat face-up with the head toward screen-top.'}
dur={'idle':[250]*6,'running':[100]*6,'charge':[90]*6,'attack':[150,180,150,70,120,200],'charge-attack':[130,170,140,70,140,220],'reload':[200,180,200,300,180,220],'hit':[100,120,140,180,160,220],'charged':[130,130,170,240,200,260],'death':[150,170,200,220,260,400],'death-back':[150,180,200,220,260,400]}
report={};clips=[]
for id in order:
 r=reg[id];file=r['file'];im=Image.open(root/file);assert im.size==(1536,1024) and im.mode=='RGBA'
 a=np.array(im);checks=[];frames=[];scale=r['scale'];s=420/512*scale
 for i in range(6):
  alpha=a[i//3*512:i//3*512+512,i%3*512:i%3*512+512,3];yy,xx=np.where(alpha>16)
  bounds=[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)]
  assert min(bounds[0],bounds[1],512-bounds[2],512-bounds[3])>=8,(id,i,bounds)
  pivot=dict(r['pivots'][i])
  for axis,lo,hi in [('x',bounds[0],bounds[2]),('y',bounds[1],bounds[3])]:
   lower=hi-248/s;upper=lo+248/s
   assert lower<=upper,(id,i,'preview too large')
   pivot[axis]=round(min(max(pivot[axis],lower),upper),2)
  frames.append({'index':i,'sourceIndex':i,'x':i%3*512,'y':i//3*512,'width':512,'height':512,'pivot':pivot})
  dil=np.array(Image.fromarray((alpha>128).astype('uint8')*255).filter(ImageFilter.MaxFilter(7)))>0
  checks.append({'frame':i,'bounds':bounds,'authoredPivot':r['pivots'][i],'previewPivot':pivot,'maxAlphaBeyond3px':int(alpha[~dil].max()),'pixelsAbove16Beyond3px':int((alpha[~dil]>16).sum()),'muzzleFlashFrame':id in ['attack','charge-attack'] and i==3})
 clip={'id':id,'label':labels[id],'file':file,'loop':id in ['idle','running','charge'],'scale':scale,'frameCount':6,'durations':dur[id],'description':descs[id],'frames':frames,'sourceFrameOrder':list(range(6)),'sha256':hashlib.sha256((root/file).read_bytes()).hexdigest()}
 if id in ['attack','charge-attack']:clip['impactFrame']=3
 if id.startswith('death'):clip['corpseFile']='Corpse-'+('Back' if id=='death-back' else 'Prone')+'-v2.png'
 clips.append(clip);report[id]={'file':file,'scale':scale,'frames':checks}
d=read(root/'animations.json')
d.update(stage='single-actor-animation-review',integrationStatus='Ten animated overhead clips ready for local visual review. Match integration pending.',sheetSize={'width':1536,'height':1024},grid={'columns':3,'rows':2},artRevision='mosin-animations-v2',animations=clips,registration='Authored roots and one constant scale per clip; no per-frame scale fitting.')
(root/'animations.json').write_text(json.dumps(d,indent=2),encoding='utf-8')
g=read(root/'Generation.json');g['selectedFiles']={c['id']:c['file'] for c in clips}
for p in (root/'SourceArt').glob('*-v2-Generation.json'):
 record=read(p)
 if record not in g['records']:g['records'].append(record)
(root/'Generation.json').write_text(json.dumps(g,indent=2),encoding='utf-8')
(root/'Animation-v2-Validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
p=root/'Actor_Review.html';html=p.read_text(encoding='utf-8').replace('Russian Mosin-Nagant · First Idle Frame','Russian Mosin-Nagant · Animation Review').replace('First idle frame · Soviet khaki uniform and steel helmet · strict overhead view.','Ten overhead motions · rifle firing, bolt reload and both settled corpse poses.').replace('First idle v1','Animations v2').replace('Loading first idle frame…','Loading ten sprite sheets…').replace('revision=mosin-first-idle-v1','revision=mosin-animations-v2')
p.write_text(html,encoding='utf-8')
print(json.dumps({c['id']:c['file'] for c in clips}))


