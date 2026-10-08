"""Select the overhead, medium-metal-armor idle and preserve prior drafts."""
from pathlib import Path
from PIL import Image
from urllib.request import urlopen
import hashlib, json, shutil

root=Path(__file__).resolve().parent.parent
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def write(p,v): p.write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
old_hash=sha(root/'Idle-v1.png')
draft=read(root/'SourceArt/Generation-idle-v2.json')
shutil.copy2(draft['generatedSource'],root/'Idle-v2.png')
record=read(root/'SourceArt/Generation-idle-v3.json')
shutil.copy2(record['generatedSource'],root/'Idle-v3.png')
im=Image.open(root/'Idle-v3.png')
assert im.mode=='RGBA'
w,h=im.size
a=im.getchannel('A')
assert a.getextrema()[0]==0 and a.getextrema()[1]>=240
assert all(a.getpixel(pt)==0 for pt in [(0,0),(w-1,0),(0,h-1),(w-1,h-1)])
meta=read(root/'animations.json')
meta.update(sheetSize={'width':w,'height':h},integrationStatus='More overhead idle with medium iron lamellar armor pending review before animation.',equipmentFinish='Sleeveless iron lamellar vest, light shoulder lamellae, reinforced bracers, russet kaftan and felt cap; unarmored horse')
clip=meta['animations'][0]
clip.update(file='Idle-v3.png',scale=w/max(w,h),description='More overhead mounted bowman with medium iron lamellar armor; left hand holds the bow, right hand the reins.')
clip['frames'][0].update(width=w,height=h,pivot={'x':w/2,'y':h/2})
write(root/'animations.json',meta)
html=(root/'Actor_Review.html').read_text(encoding='utf-8').replace('Idle-v1.png','Idle-v3.png').replace('Circa AD 900 steppe rider: recurve bow, riding kaftan, quiver, and an unarmored horse.','Circa AD 900 steppe rider: iron lamellar vest, recurve bow, riding kaftan, and an unarmored horse.')
(root/'Actor_Review.html').write_text(html,encoding='utf-8')
generation=read(root/'Generation.json')
for r in generation['records']:
    if r.get('file')=='Idle-v1.png': r['status']='superseded-idle-preserved'
for candidate in [{**draft,'status':'superseded-camera-draft-preserved'},record]:
    if not any(r.get('file')==candidate['file'] for r in generation['records']): generation['records'].append(candidate)
generation['userApproval']='Overhead medium-metal-armor idle pending review.'
write(root/'Generation.json',generation)
assert sha(root/'Idle-v1.png')==old_hash
write(root/'Validation.json',{'date':'2026-10-07','size':[w,h],'mode':im.mode,'alphaExtrema':a.getextrema(),'visibleBounds':a.getbbox(),'sha256':sha(root/'Idle-v3.png'),'previousIdleSha256':old_hash,'previousIdlePreserved':True,'userApproval':'Idle-v3 pending review','runtimeIntegration':False})
checks=[]
for name in ['Actor_Review.html','animations.json','Idle-v3.png']:
    with urlopen('http://127.0.0.1:9018/Cultures/Russians/Units/EarlyMedieval/HorseArcher/'+name,timeout=10) as response:
        assert response.status==200 and response.read()==(root/name).read_bytes()
        checks.append({'file':name,'status':200})
write(root/'Browser-Review.json',{'httpChecks':checks,'nativeIdleInspected':True,'browserPlaybackVerified':False,'limitation':'Windows browser automation sandbox unavailable.','userApproval':'Idle-v3 pending review','runtimeIntegration':False})
print('Idle-v3 selected: native alpha, previous draft preservation and served assets pass.')
