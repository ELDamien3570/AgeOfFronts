"""Pack two complete authored thrust atlases and update only their selected clips."""
from pathlib import Path
from PIL import Image
import json, shutil, hashlib
ROOT=Path(__file__).resolve().parent.parent
SRC=ROOT/'SourceArt'
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def write(p,d): p.write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
gen=read(SRC/'Thrust-Generation-v4.json')
data=read(ROOT/'animations.json')
checks=[]; recipes=[]
for rec in gen['records']:
 native=SRC/rec['nativeFile']
 if not native.exists(): shutil.copy2(rec['generatedSource'],native)
 im=Image.open(native)
 assert im.mode=='RGBA' and im.size==(1536,1024)
 out=Image.new('RGBA',im.size);frames=[];fc=[];tracks=[]
 for i in range(6):
  x,y=i%3*512,i//3*512
  pose=im.crop((x,y,x+512,y+512)).resize((435,435),Image.Resampling.LANCZOS)
  offset=rec.get('packingOffsets',[[0,0]]*6)[i]
  out.paste(pose,(x+38+offset[0],y+38+offset[1]))
  alpha=pose.getchannel('A');bounds=alpha.point(lambda v:255 if v>16 else 0).getbbox()
  assert bounds
  frames.append({'index':i,'sourceIndex':i,'x':x,'y':y,'width':512,'height':512,'pivot':{'x':256,'y':256}})
  fc.append({'frame':i,'visibleBounds':[bounds[0]+38+offset[0],bounds[1]+38+offset[1],bounds[2]+38+offset[0],bounds[3]+38+offset[1]],'sha256':hashlib.sha256(pose.tobytes()).hexdigest(),'guardAlphaMax':0})
  tracks.append({'frame':i,'sourceRect':[x,y,x+512,y+512],'uniformScale':435/512,'destinationOffset':[38+offset[0],38+offset[1]]})
 assert len({c['sha256'] for c in fc})==6
 out.save(ROOT/rec['file'])
 clip=next(c for c in data['animations'] if c['id']==rec['id'])
 clip.update({'file':rec['file'],'frames':frames,'description':'Fixed overhand grip: hand and entire spear drive forward together, then retract.','durations':[140,170,100,170,160,220]})
 checks.append({'clip':rec['id'],'file':rec['file'],'distinctFrames':6,'frames':fc})
 recipes.append({'clip':rec['id'],'source':rec['nativeFile'],'sourceSha256':sha(native),'output':rec['file'],'outputSha256':sha(ROOT/rec['file']),'tracks':tracks})
write(ROOT/'animations.json',data)
history=read(ROOT/'Generation.json');history['thrustRevisionV4']=gen;write(ROOT/'Generation.json',history)
v=read(ROOT/'Validation.json');v['clips']=[c for c in v['clips'] if c['clip'] not in ['attack','charge-attack']]+checks;v['thrustRevisionV4']='Whole authored poses; awaiting user review.';write(ROOT/'Validation.json',v)
write(SRC/'Thrust-Composition-v4.json',{'method':'Whole-pose atlas packing, preserved generated alpha.','clips':recipes})
base=read(SRC/'Animation-Generation.json')
for rec in gen['records']:
 old=next(c for c in base['records'] if c['id']==rec['id']);base.setdefault('supersededRecords',[]).append(old)
 base['records']=[rec if c['id']==rec['id'] else c for c in base['records']]
write(SRC/'Animation-Generation.json',base)
for name,expected in read(SRC/'Thrust-v2-Unchanged.json').items():assert sha(ROOT/name)==expected,name
print('Updated two thrusts; seven other animation sheets unchanged.')
