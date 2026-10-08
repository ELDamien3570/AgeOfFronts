"""Publish the first Boyar idle for local visual review."""
from pathlib import Path
from PIL import Image
from urllib.request import urlopen
import json, shutil, hashlib

root=Path(__file__).resolve().parent
units=root.parent.parent
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def write(p,v): p.write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
paths=sorted((root/'SourceArt').glob('Generation-idle-v*.json'),key=lambda p:int(p.stem.rsplit('-v',1)[1]))
records=[read(p) for p in paths]
for p,record in zip(paths,records):
    shutil.copy2(record['generatedSource'],root/('Idle-v'+p.stem.rsplit('-v',1)[1]+'.png'))
selected='Idle-v'+paths[-1].stem.rsplit('-v',1)[1]+'.png'
im=Image.open(root/selected)
assert im.mode=='RGBA'
w,h=im.size
a=im.getchannel('A')
assert a.getextrema()[0]==0 and a.getextrema()[1]>=240
assert all(a.getpixel(pt)==0 for pt in [(0,0),(w-1,0),(0,h-1),(w-1,h-1)])
meta=read(units/'EarlyMedieval/Druzhina/SourceArt/Before-Animation-animations.json')
meta.update(age='LateMedieval',unit='Boyar',category='Heavy Cavalry',integrationStatus='Fresh idle design pending visual review before animation.',weapon='Wooden-haft steel battle axe with broad curved blade and short rear spike',offhand='Round steel boss shield on left arm; reins gathered beneath grip',mount='Compact dark horse with charcoal blackened steel strip and mail barding, chamfron and burgundy lining',equipmentFinish='Bright steel rider armor: pointed helmet with mail aventail, mail sleeves, plate and lamellar armor, articulated leg armor',historicalDirection='Late Medieval Russian Boyar inspired by the user equipment photograph.',sheetSize={'width':w,'height':h})
c=meta['animations'][0]
c.update(file=selected,scale=w/max(w,h),description='Overhead Boyar on a compact armored horse, axe resting on the right shoulder, round steel shield, and mail and plate armor.',frameCount=1)
c['frames'][0].update(width=w,height=h,pivot={'x':w/2,'y':h/2})
write(root/'animations.json',meta)
html=(units/'LateMedieval/HorseArcher/SourceArt/Before-Animation-Actor_Review.html').read_text(encoding='utf-8')
for old,new in [('Russian Late Medieval Armored Horse Archer','Russian Late Medieval Boyar'),('One armored horse archer. One idle frame.','One Boyar. One idle frame.'),('Refined steel lamellar and mail, recurve bow, and articulated armor on the horse.','Steel and mail, round shield, shoulder-resting axe, and heavy horse barding from the supplied reference.'),('Armored Horse Archer mounted archer sprite','Boyar sprite'),('Loading armored horse archer idle','Loading Boyar idle'),('Idle-v2.png','Idle-v1.png'),('../../EarlyMedieval/HorseArcher/Actor_Review.html','../../EarlyMedieval/Druzhina/Actor_Review.html'),('Early Medieval base','Druzhina camera reference')]:
    html=html.replace(old,new)
html=html.replace('href="Idle-v1.png"','href="'+selected+'"')
(root/'Actor_Review.html').write_text(html,encoding='utf-8')
attachment=Path('C:/Users/Damien/AppData/Local/Temp/codex-clipboard-b459ff98-6cb5-4265-92e5-daaa465d0141.png')
shutil.copy2(attachment,root/'SourceArt/User-Equipment-Reference.png')
write(root/'Generation.json',{'date':'2026-10-07','mode':'built-in-imagegen','userApproval':'User approved the fresh v6 Boyar design and requested a steeper top-down camera. Camera revision pending review; animations not yet generated.','selectedIdle':selected,'referenceCopy':'SourceArt/User-Equipment-Reference.png','records':records})
manifest=read(units/'Manifest.json')
entry={'id':'russian-latemedieval-boyar','age':'LateMedieval','label':'Russian Boyar - single rider','metadata':'LateMedieval/Boyar/animations.json','review':'LateMedieval/Boyar/Actor_Review.html','actorCount':1}
if not any(e['id']==entry['id'] for e in manifest['units']):
    manifest['units'].append(entry)
    write(units/'Manifest.json',manifest)
write(root/'Validation.json',{'date':'2026-10-07','file':selected,'size':[w,h],'mode':im.mode,'alphaExtrema':a.getextrema(),'visibleBounds':a.getbbox(),'sha256':hashlib.sha256((root/selected).read_bytes()).hexdigest(),'userApproval':'Revised idle pending review','runtimeIntegration':False})
checks=[]
for name in ['Actor_Review.html','animations.json',selected]:
    with urlopen('http://127.0.0.1:9018/Cultures/Russians/Units/LateMedieval/Boyar/'+name,timeout=10) as response:
        assert response.status==200 and response.read()==(root/name).read_bytes()
        checks.append({'file':name,'status':200})
write(root/'Browser-Review.json',{'httpChecks':checks,'nativeIdleInspected':True,'browserPlaybackVerified':False,'limitation':'Browser opening queued; HTTP validation does not establish rendered playback.','userApproval':'Idle pending review','runtimeIntegration':False})
print('Revised Boyar idle and three served review assets validated.')

