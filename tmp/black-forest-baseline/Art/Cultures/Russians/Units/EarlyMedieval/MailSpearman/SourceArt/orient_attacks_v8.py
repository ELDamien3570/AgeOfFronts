"""Orient complete v6 painted poses to attack toward screen bottom; no limb rigging."""
from pathlib import Path
from PIL import Image
import json,math,hashlib
ROOT=Path(__file__).resolve().parent.parent;SRC=ROOT/'SourceArt'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def write(p,d):p.write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
data=read(ROOT/'animations.json');recipes=[]
for ident,source,outfile,angles in [('attack','Attack-Rebuilt-v6.png','Attack-Forward-Pose-v8.png',[45,45,45,45,45,45]),('charge-attack','Charge-Attack-Rebuilt-v6.png','Charge-Attack-Forward-Pose-v8.png',[37,37,43,45,38,40])]:
 im=Image.open(ROOT/source);out=Image.new('RGBA',(1536,1024));tracks=[]
 for i,angle in enumerate(angles):
  x,y=i%3*512,i//3*512;pose=im.crop((x,y,x+512,y+512))
  a=math.radians(angle);k=1/.85;A=math.cos(a)*k;B=math.sin(a)*k;D=-math.sin(a)*k;E=math.cos(a)*k
  transformed=pose.transform((512,512),Image.Transform.AFFINE,(A,B,256-A*256-B*256,D,E,256-D*256-E*256),Image.Resampling.BICUBIC)
  alpha=transformed.getchannel('A');assert max(alpha.crop(b).getextrema()[1] for b in [(0,0,512,8),(0,504,512,512),(0,0,8,512),(504,0,512,512)])==0,(ident,i)
  out.paste(transformed,(x,y));tracks.append({'frame':i,'sourceRect':[x,y,x+512,y+512],'clockwiseRotationDegrees':angle,'uniformScale':.85,'pivot':[256,256]})
 out.save(ROOT/outfile);clip=next(c for c in data['animations'] if c['id']==ident)
 clip.update({'file':outfile,'scale':1/.85,'description':'Complete painted overhand attack poses oriented to thrust toward the bottom of the screen.'})
 recipes.append({'clip':ident,'source':source,'output':outfile,'tracks':tracks})
write(ROOT/'animations.json',data);write(SRC/'Forward-Pose-Composition-v8.json',{'method':'Whole-pose orientation of approved v6 artwork; no isolated limb or weapon edits.','clips':recipes})
history=read(ROOT/'Generation.json');history['forwardPoseV8']=recipes;write(ROOT/'Generation.json',history)
validation=read(ROOT/'Validation.json');validation['forwardPoseV8']={'alphaGuardsClear':True,'wholePosesPreserved':True,'artisticApproval':'Pending'};write(ROOT/'Validation.json',validation)
for name,expected in read(SRC/'Thrust-v2-Unchanged.json').items():assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==expected
print('Oriented both complete painted attack sequences; other seven sheets unchanged.')
