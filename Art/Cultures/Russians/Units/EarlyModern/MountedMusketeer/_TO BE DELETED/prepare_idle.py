"""Publish the first mounted musketeer idle for local visual review."""
from pathlib import Path
from PIL import Image
from urllib.request import urlopen
import json, shutil, hashlib

root=Path(__file__).resolve().parent
units=root.parent.parent
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def write(p,v): p.write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
record=read(root/'SourceArt/Generation-idle-v1.json')
shutil.copy2(record['generatedSource'],root/'Idle-v1.png')
im=Image.open(root/'Idle-v1.png')
assert im.mode=='RGBA'
w,h=im.size
a=im.getchannel('A')
assert a.getextrema()[0]==0 and a.getextrema()[1]>=240
assert all(a.getpixel(pt)==0 for pt in [(0,0),(w-1,0),(0,h-1),(w-1,h-1)])
meta=read(units/'EarlyMedieval/Druzhina/SourceArt/Before-Animation-animations.json')
meta.update(age='EarlyModern',unit='Mounted Musketeer',category='Mounted Ranged',integrationStatus='First idle design pending visual review before animation.',weapon='Early wooden-stock musket with iron barrel, lock mechanism and ramrod',offhand='Right hand holds musket at rest; left hand holds reins',mount='Unarmored bay/dun horse with leather harness and saddle',equipmentFinish='Fur-edged red cap, long russet kaftan, brass closures, leather powder gear and riding boots',historicalDirection='Stylized late 17th-century Russian-inspired mounted musketeer; first idle design.',sheetSize={'width':w,'height':h})
c=meta['animations'][0]
c.update(file='Idle-v1.png',scale=w/max(w,h),description='Relaxed mounted musketeer with musket held at rest, long kaftan, fur-edged cap and powder gear.',frameCount=1)
c['frames'][0].update(width=w,height=h,pivot={'x':w/2,'y':h/2})
write(root/'animations.json',meta)
html=(units/'LateMedieval/HorseArcher/SourceArt/Before-Animation-Actor_Review.html').read_text(encoding='utf-8')
for old,new in [('Russian Late Medieval Armored Horse Archer','Russian Early Modern Mounted Musketeer'),('Late Medieval Age','Early Modern Age'),('One armored horse archer. One idle frame.','One mounted musketeer. One idle frame.'),('Refined steel lamellar and mail, recurve bow, and articulated armor on the horse.','Late 17th-century direction: fur-edged cap, long kaftan, early musket, and powder gear.'),('Armored Horse Archer mounted archer sprite','Mounted Musketeer sprite'),('Loading armored horse archer idle','Loading mounted musketeer idle'),('Idle-v2.png','Idle-v1.png'),('../../EarlyMedieval/HorseArcher/Actor_Review.html','../RusMusketeer/Actor_Review.html'),('Early Medieval base','Russian musketeer reference')]:
    html=html.replace(old,new)
(root/'Actor_Review.html').write_text(html,encoding='utf-8')
write(root/'Generation.json',{'date':'2026-10-07','mode':'built-in-imagegen','userApproval':'User selected late 17th-century direction. Idle pending review; animations not yet generated.','records':[record]})
manifest=read(units/'Manifest.json')
entry={'id':'russian-earlymodern-mounted-musketeer','age':'EarlyModern','label':'Russian mounted musketeer - single rider','metadata':'EarlyModern/MountedMusketeer/animations.json','review':'EarlyModern/MountedMusketeer/Actor_Review.html','actorCount':1}
if not any(e['id']==entry['id'] for e in manifest['units']):
    manifest['units'].append(entry)
    write(units/'Manifest.json',manifest)
write(root/'Validation.json',{'date':'2026-10-07','size':[w,h],'mode':im.mode,'alphaExtrema':a.getextrema(),'visibleBounds':a.getbbox(),'sha256':hashlib.sha256((root/'Idle-v1.png').read_bytes()).hexdigest(),'userApproval':'Idle pending review','runtimeIntegration':False})
checks=[]
for name in ['Actor_Review.html','animations.json','Idle-v1.png']:
    with urlopen('http://127.0.0.1:9018/Cultures/Russians/Units/EarlyModern/MountedMusketeer/'+name,timeout=10) as response:
        assert response.status==200 and response.read()==(root/name).read_bytes()
        checks.append({'file':name,'status':200})
write(root/'Browser-Review.json',{'httpChecks':checks,'nativeIdleInspected':True,'browserPlaybackVerified':False,'limitation':'Browser opening queued; HTTP validation does not establish rendered playback.','userApproval':'Idle pending review','runtimeIntegration':False})
print('Mounted musketeer idle and three served review assets validated.')
