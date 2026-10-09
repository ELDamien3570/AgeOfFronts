"""Editable two-bone arm rig with a single rigid spear-and-hand layer."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops
import math,json,hashlib,shutil
ROOT=Path(__file__).resolve().parent.parent
SRC=ROOT/'SourceArt';LAYERS=SRC/'Thrust-Rig-v5';LAYERS.mkdir(exist_ok=True)
def write(p,d):p.write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
source=Image.open(SRC/'Native-Attack-Fixed-Grip-v4.png').crop((0,0,512,512))
def maskpoly(points):
 m=Image.new('L',(512,512));ImageDraw.Draw(m).polygon(points,fill=255);return m
def layer(points):
 out=source.copy();out.putalpha(ImageChops.multiply(source.getchannel('A'),maskpoly(points)));return out
weapon_points=[(118,0),(161,0),(168,243),(177,261),(177,291),(163,311),(174,375),(181,417),(167,489),(132,489),(119,417),(135,374),(127,310),(112,294),(111,257),(126,241)]
weapon=layer(weapon_points)
body=source.copy();erase=maskpoly(weapon_points)
arm_erase=maskpoly([(128,185),(160,174),(181,187),(194,211),(191,231),(179,254),(168,277),(123,283),(119,245)])
erase=ImageChops.lighter(erase,arm_erase)
body.putalpha(ImageChops.multiply(source.getchannel('A'),ImageChops.invert(erase)))
upper=layer([(158,165),(213,175),(218,210),(193,235),(157,226),(151,204)])
fore=layer([(131,210),(174,210),(195,231),(180,261),(166,280),(130,277),(125,240)])
upper.putalpha(ImageChops.multiply(upper.getchannel('A'),ImageChops.invert(maskpoly(weapon_points))))
fore.putalpha(ImageChops.multiply(fore.getchannel('A'),ImageChops.invert(maskpoly(weapon_points))))
for name,im in [('Body',body),('Spear-And-Hand',weapon),('Upper-Arm',upper),('Forearm',fore)]:im.save(LAYERS/(name+'.png'))
def bone_transform(im,a,b,c,d):
 # Source bone a->b maps to destination c->d; preserve transverse thickness.
 ux,uy=b[0]-a[0],b[1]-a[1];sl=math.hypot(ux,uy);ux/=sl;uy/=sl
 vx,vy=d[0]-c[0],d[1]-c[1];dl=math.hypot(vx,vy);vx/=dl;vy/=dl
 k=sl/dl
 A=ux*k*vx+uy*vy;B=ux*k*vy-uy*vx
 D=uy*k*vx-ux*vy;E=uy*k*vy+ux*vx
 C=a[0]-A*c[0]-B*c[1];F=a[1]-D*c[0]-E*c[1]
 return im.transform((640,640),Image.Transform.AFFINE,(A,B,C,D,E,F),Image.Resampling.BICUBIC)
def elbow(s,w):
 dx,dy=w[0]-s[0],w[1]-s[1];distance=math.hypot(dx,dy);u=(dx/distance,dy/distance)
 l1,l2=60,110;t=(l1*l1-l2*l2+distance*distance)/(2*distance);h=math.sqrt(max(0,l1*l1-t*t))
 return (s[0]+u[0]*t-u[1]*h,s[1]+u[1]*t+u[0]*h)
data=read(ROOT/'animations.json');hist=read(ROOT/'Generation.json');validation=read(ROOT/'Validation.json')
for n in ['animations.json','Generation.json','Validation.json']:
 p=SRC/('Before-Rig-v5-'+n)
 if not p.exists():shutil.copy2(ROOT/n,p)
definitions=[('attack','Attack-Rig-v5.png',[339,320,302,302,324,360,403,421,403,368,343,339]),('charge-attack','Charge-Attack-Rig-v5.png',[339,315,295,295,322,363,405,421,405,369,344,339])]
body_y=[0,-2,-4,-4,0,4,9,14,9,4,0,0]
recipes=[];checks=[]
for ident,file,positions in definitions:
 sheet=Image.new('RGBA',(2048,1536));frames=[];tracks=[];motion=[]
 for i,wy in enumerate(positions):
  canvas=Image.new('RGBA',(640,640))
  shoulder=(254,264+body_y[i]);wrist=(209,wy);joint=elbow(shoulder,wrist)
  canvas.alpha_composite(bone_transform(upper,(190,198),(168,224),shoulder,joint))
  canvas.alpha_composite(bone_transform(fore,(168,224),(145,275),joint,wrist))
  # Same pixels, same orientation, same grip: translation only for spear + hand.
  canvas.alpha_composite(body,(64,64+body_y[i]))
  canvas.alpha_composite(weapon,(64,round(wy-275)))
  pose=canvas.resize((512,512),Image.Resampling.LANCZOS);x,y=i%4*512,i//4*512;sheet.paste(pose,(x,y))
  alpha=pose.getchannel('A');guard=max(alpha.crop(b).getextrema()[1] for b in [(0,0,512,8),(0,504,512,512),(0,0,8,512),(504,0,512,512)]);assert guard==0,(ident,i,guard)
  frames.append({'index':i,'sourceIndex':i,'x':x,'y':y,'width':512,'height':512,'pivot':{'x':256,'y':256}})
  tracks.append({'frame':i,'bodyOffset':[64,64+body_y[i]],'shoulder':shoulder,'elbow':joint,'wrist':wrist,'weaponTranslation':[64,round(wy-275)],'weaponRotation':0,'weaponScale':1,'gripSlipPixels':0})
  motion.append(pose)
 sheet.save(ROOT/file)
 clip=next(c for c in data['animations'] if c['id']==ident)
 clip.update({'file':file,'frames':frames,'frameCount':12,'sheetSize':{'width':2048,'height':1536},'grid':{'columns':4,'rows':3},'impactFrame':7,'durations':[140,80,100,80,45,45,50,90,60,80,90,160],'description':'Overhand thrust: fixed spear-and-hand layer driven forward by a two-bone arm; retracts without sliding the grip.'})
 checks.append({'clip':ident,'file':file,'frameCount':12,'guardAlphaMax':0,'gripSlipPixels':0,'spearRotationChange':0,'spearScaleChange':0,'forwardTravelPixels':(max(positions)-min(positions))*.8})
 recipes.append({'clip':ident,'file':file,'tracks':tracks})
 proof=[]
 for pose in motion:
  bg=Image.new('RGBA',(512,512),(42,70,47,255));bg.alpha_composite(pose);proof.append(bg.convert('RGB'))
 proof[0].save(ROOT/('Review-'+ident+'-rig-v5.webp'),save_all=True,append_images=proof[1:],duration=clip['durations'],loop=0)
write(ROOT/'animations.json',data)
recipe={'method':'User-authorized rigid spear-and-hand layer with two-bone arm and editable position tracks.','source':'Native-Attack-Fixed-Grip-v4.png','sourceSha256':sha(SRC/'Native-Attack-Fixed-Grip-v4.png'),'layers':{n:sha(LAYERS/(n+'.png')) for n in ['Body','Spear-And-Hand','Upper-Arm','Forearm']},'canvas':640,'outputScale':.8,'clips':recipes}
write(SRC/'Thrust-Rig-v5.json',recipe);hist['thrustRigV5']=recipe;write(ROOT/'Generation.json',hist)
validation['clips']=[c for c in validation['clips'] if c['clip'] not in ['attack','charge-attack']]+checks;validation['frameCount']=66;validation['thrustRigV5']='Pending visual review; rigid grip and full weapon translation verified.';write(ROOT/'Validation.json',validation)
for name,expected in read(SRC/'Thrust-v2-Unchanged.json').items():assert sha(ROOT/name)==expected,name
print('Two twelve-frame rigid-layer thrusts baked; fixed grip and unchanged seven other sheets verified.')
