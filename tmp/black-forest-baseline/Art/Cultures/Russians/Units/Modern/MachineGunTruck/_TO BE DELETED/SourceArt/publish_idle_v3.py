"""Publish the overhead camera revision, retaining the first truck design."""
from pathlib import Path
from PIL import Image
from urllib.request import urlopen
import json, shutil, hashlib

ROOT=Path(__file__).resolve().parent.parent
SRC=ROOT/'SourceArt'
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,v): p.write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
record=read(SRC/'Generation-idle-v3.json')
native=SRC/'Native-Idle-v3.png'
shutil.copy2(record['generatedSource'],native)
shutil.copy2(native,ROOT/'Idle-v3.png')
im=Image.open(native);w,h=im.size
assert im.mode=='RGBA'
a=im.getchannel('A');bounds=a.point(lambda v:255 if v>16 else 0).getbbox()
assert a.getextrema()[0]==0 and a.getextrema()[1]>=240
assert bounds and 0<bounds[0]<bounds[2]<w and 0<bounds[1]<bounds[3]<h
assert all(a.getpixel(p)==0 for p in [(0,0),(w-1,0),(0,h-1),(w-1,h-1)])
digest=hashlib.sha256(native.read_bytes()).hexdigest()
for name in ['animations.json','Generation.json','Validation.json','Browser-Review.json','Actor_Review.html']:
    backup=SRC/('Before-Idle-v3-'+name)
    if not backup.exists(): shutil.copy2(ROOT/name,backup)
meta=read(ROOT/'animations.json')
meta['sheetSize']={'width':w,'height':h}
meta['artRevision']='overhead-idle-v3'
clip=meta['animations'][0]
assert clip['id']=='idle' and len(meta['animations'])==1
clip.update(file='Idle-v3.png',sha256=digest,scale=w/max(w,h))
clip['frames']=[{'index':0,'sourceIndex':0,'x':0,'y':0,'width':w,'height':h,'pivot':{'x':w/2,'y':h/2}}]
write(ROOT/'animations.json',meta)
html=(ROOT/'Actor_Review.html').read_text(encoding='utf-8-sig').replace('href="Idle-v2.png"','href="Idle-v3.png"')
(ROOT/'Actor_Review.html').write_text(html,encoding='utf-8')
generation=read(ROOT/'Generation.json')
generation.update(selectedIdle='Idle-v3.png',userApproval='Overhead camera v3 pending review.')
generation['records']=[r for r in generation['records'] if r.get('file')!='Idle-v3.png']+[record]
write(ROOT/'Generation.json',generation)
write(ROOT/'Validation.json',{'file':'Idle-v3.png','size':[w,h],'mode':im.mode,'alphaExtrema':a.getextrema(),'visibleBounds':bounds,'sha256':digest,'runtimeIntegration':False,'userApproval':'Overhead idle v3 pending review'})
checks=[]
for name in ['Actor_Review.html','animations.json','Idle-v3.png']:
    with urlopen('http://127.0.0.1:9018/Cultures/Russians/Units/Modern/MachineGunTruck/'+name,timeout=10) as response:
        assert response.status==200 and response.read()==(ROOT/name).read_bytes()
        checks.append({'file':name,'status':200})
write(ROOT/'Browser-Review.json',{'httpChecks':checks,'nativeIdleInspected':True,'browserPlaybackVerified':False,'runtimeIntegration':False,'userApproval':'Overhead idle v3 pending review'})
print('Overhead truck idle v3 saved; alpha, bounds and local review assets verified.')

