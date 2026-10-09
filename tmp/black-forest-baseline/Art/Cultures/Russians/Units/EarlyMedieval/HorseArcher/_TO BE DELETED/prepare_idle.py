"""Publish a native transparent single idle design to the local art review."""
from pathlib import Path
from PIL import Image
from urllib.request import urlopen
import hashlib, json, shutil

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
meta=read(root.parent/'Druzhina/SourceArt/Before-Animation-animations.json')
meta.update(unit='Pontic Steppe Horse Archer',category='Mounted Archer',stage='single-mounted-idle-design-review',integrationStatus='First idle design pending visual review before animation.',weapon='Compact wood and horn composite recurve bow',offhand='Left hand holds bow; right hand holds reins',mount='Unarmored dun/bay horse, leather harness, wooden-framed saddle and felt saddlecloth',equipmentFinish='Muted russet riding kaftan, felt cap, leather belt fittings, bracer, trousers and riding boots',historicalDirection='Regional Pontic steppe mounted archer circa AD 900; inspired reconstruction, no specific tribal assignment.',sheetSize={'width':w,'height':h})
c=meta['animations'][0]
c.update(file='Idle-v1.png',scale=w/max(w,h),description='Relaxed mounted bowman; composite recurve bow held in the left hand, reins in the right.',frameCount=1)
c['frames'][0].update(width=w,height=h,pivot={'x':w/2,'y':h/2})
write(root/'animations.json',meta)
html=(root.parent/'Druzhina/Actor_Review.html').read_text(encoding='utf-8')
html=html.replace('Druzhina','Pontic Horse Archer').replace('One Pontic Horse Archer. Nine motions.','One mounted bowman. One idle frame.').replace('Heavy lamellar and mail, long lance, and an armored horse with iron and brass fittings.','Circa AD 900 steppe rider: recurve bow, riding kaftan, quiver, and an unarmored horse.').replace('heavy cavalry sprite','mounted archer sprite').replace('max="5"','max="0"').replace('1 / 6','1 / 1').replace('Loading nine Pontic Horse Archer sprite sheets','Loading mounted archer idle').replace('Idle-Animated-v1.png','Idle-v1.png')
(root/'Actor_Review.html').write_text(html,encoding='utf-8')
write(root/'Generation.json',{'date':'2026-10-07','mode':'built-in-imagegen','userApproval':'Idle design pending review; no animations generated yet.','records':[record]})
manifest=read(units/'Manifest.json')
entry={'id':'russian-earlymedieval-horse-archer','age':'EarlyMedieval','label':'Russian Pontic steppe horse archer - single rider','metadata':'EarlyMedieval/HorseArcher/animations.json','review':'EarlyMedieval/HorseArcher/Actor_Review.html','actorCount':1}
if not any(e['id']==entry['id'] for e in manifest['units']):
    manifest['units'].append(entry)
    write(units/'Manifest.json',manifest)
write(root/'Validation.json',{'date':'2026-10-07','size':[w,h],'mode':im.mode,'alphaExtrema':a.getextrema(),'visibleBounds':a.getbbox(),'sha256':hashlib.sha256((root/'Idle-v1.png').read_bytes()).hexdigest(),'userApproval':'Idle pending review','runtimeIntegration':False})
checks=[]
for name in ['Actor_Review.html','animations.json','Idle-v1.png']:
    with urlopen('http://127.0.0.1:9018/Cultures/Russians/Units/EarlyMedieval/HorseArcher/'+name,timeout=10) as response:
        assert response.status==200 and response.read()==(root/name).read_bytes()
        checks.append({'file':name,'status':200})
write(root/'Browser-Review.json',{'httpChecks':checks,'nativeIdleInspected':True,'browserPlaybackVerified':False,'limitation':'Windows browser automation sandbox unavailable.','userApproval':'Pending idle review','runtimeIntegration':False})
print('Native idle and three served review assets validated; Russian unit registered.')
