from pathlib import Path
import json,hashlib,shutil
from PIL import Image,ImageFilter
import numpy as np
root=Path(__file__).resolve().parent.parent
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
backup=root/'SourceArt'/'Before-Animation-v3';backup.mkdir(exist_ok=True)
for f in ['Actor_Review.html','Generation.json']:
 if not (backup/f).exists():shutil.copy2(root/f,backup/f)
reg={}
for name in ['Movement','Weapons','Damage']:reg.update(read(root/'SourceArt'/f'{name}-v3-Registration.json'))
order=['idle','running','attack','missile','hit','death']
labels={'idle':'Radar idle','running':'Tracked movement','attack':'Autocannon fire','missile':'Missile launch','hit':'Get hit','death':'Destruction'}
descs={'idle':'Stationary hull and guns with the search radar scanning.','running':'Tracks cycle while the vehicle holds its forward heading.','attack':'Paired autocannons fire from their four forward muzzle tips.','missile':'Launch a missile from the side canister bank.','hit':'Localized armor impact, brief recoil and recovery.','death':'Damage, localized fire and collapse into a settled wreck.'}
timings={'idle':[250]*6,'running':[100]*6,'attack':[160,100,100,80,100,200],'missile':[180,150,100,100,180,260],'hit':[130,80,120,180,180,260],'death':[180,160,200,250,300,500]}
clips=[];report={}
for id in order:
 r=reg[id];file=r['file'];im=Image.open(root/file);assert im.size==(1536,1024) and im.mode=='RGBA'
 arr=np.array(im);frames=[];checks=[];s=420/512*r['scale']
 for i in range(6):
  alpha=arr[i//3*512:i//3*512+512,i%3*512:i%3*512+512,3];yy,xx=np.where(alpha>16)
  bounds=[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)]
  assert min(bounds[0],bounds[1],512-bounds[2],512-bounds[3])>=4,(id,i,bounds)
  pivot=dict(r['pivots'][i])
  for axis,lo,hi in [('x',bounds[0],bounds[2]),('y',bounds[1],bounds[3])]:
   lower=hi-248/s;upper=lo+248/s
   assert lower<=upper,(id,i,'preview too wide')
   pivot[axis]=round(min(max(pivot[axis],lower),upper),2)
  frames.append({'index':i,'sourceIndex':i,'x':i%3*512,'y':i//3*512,'width':512,'height':512,'pivot':pivot})
  dil=np.array(Image.fromarray((alpha>128).astype('uint8')*255).filter(ImageFilter.MaxFilter(7)))>0
  checks.append({'frame':i,'bounds':bounds,'authoredPivot':r['pivots'][i],'previewPivot':pivot,'maxAlphaBeyond3px':int(alpha[~dil].max()),'pixelsAbove16Beyond3px':int((alpha[~dil]>16).sum())})
 clip={'id':id,'label':labels[id],'file':file,'scale':r['scale'],'loop':id in ['idle','running'],'frameCount':6,'durations':timings[id],'description':descs[id],'frames':frames,'sourceFrameOrder':list(range(6)),'sha256':hashlib.sha256((root/file).read_bytes()).hexdigest()}
 if id=='death':clip['wreckFile']='Wreck-v3.png'
 clips.append(clip);report[id]={'file':file,'scale':r['scale'],'frames':checks}
d={'schemaVersion':1,'cultureId':'russians','age':'Modern','unit':'2K22 Tunguska','category':'Air Defense Vehicle','actorCount':1,'stage':'single-vehicle-animation-review','integrationStatus':'Six local animation clips ready for visual review. Runtime integration pending.','camera':'vertical-overhead-orthographic','facing':'screen-down','sheetSize':{'width':1536,'height':1024},'grid':{'columns':3,'rows':2},'reviewFootprint':420,'registration':'Explicit body roots and one constant scale per clip, never per-frame bounds fitting.','artRevision':'tunguska-animations-v3','animations':clips}
(root/'animations.json').write_text(json.dumps(d,indent=2),encoding='utf-8')
records=[read(root/'Generation.json')]
for p in (root/'SourceArt').glob('*v3*Generation*.json'):records.append(read(p))
g={'mode':'built-in-imagegen','selectedFiles':{c['id']:c['file'] for c in clips},'records':records,'alphaPolicy':'Native generated transparency preserved; effects are authored into their sheets.'}
(root/'Generation.json').write_text(json.dumps(g,indent=2),encoding='utf-8')
(root/'Animation-v3-Validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
html=Path('Art/Cultures/Russians/Units/EarlyModern/MosinNagant/Actor_Review.html').read_text(encoding='utf-8')
html=html.replace('Russian Mosin-Nagant · Animation Review','2K22 Tunguska · Animation Review').replace('Age of Fronts · Russians · Early Modern','Age of Fronts · Russians · Modern').replace('Mosin-Nagant infantry.','2K22 Tunguska.').replace('Ten overhead motions · rifle firing, bolt reload and both settled corpse poses.','Six overhead vehicle motions · radar, tracks, guns, missiles, impact and destruction.').replace('Aimed fire v3','Animations v3').replace('single Mosin-Nagant soldier','single Tunguska vehicle').replace('Loading ten sprite sheets…','Loading six vehicle sheets…').replace('revision=mosin-aimed-fire-v3','revision=tunguska-animations-v3')
(root/'Actor_Review.html').write_text(html,encoding='utf-8')
print(json.dumps({c['id']:c['file'] for c in clips}))

