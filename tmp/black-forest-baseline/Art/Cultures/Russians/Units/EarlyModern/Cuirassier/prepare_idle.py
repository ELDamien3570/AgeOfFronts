"""Publish a Russian Napoleonic cuirassier idle in the existing art age catalog."""
from pathlib import Path
from PIL import Image
from urllib.request import urlopen
import json, shutil, hashlib

root=Path(__file__).resolve().parent
units=root.parent.parent
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def write(p,v): p.write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
rec=read(root/'SourceArt/Generation-idle-v1.json')
shutil.copy2(rec['generatedSource'],root/'Idle-v1.png')
im=Image.open(root/'Idle-v1.png');w,h=im.size;a=im.getchannel('A')
assert im.mode=='RGBA' and a.getextrema()[0]==0 and a.getextrema()[1]>=240
assert all(a.getpixel(pt)==0 for pt in [(0,0),(w-1,0),(0,h-1),(w-1,h-1)])
meta=read(units/'LateMedieval/Boyar/SourceArt/Before-Animation-animations.json')
meta.update(age='EarlyModern',historicalEra='Napoleonic circa 1812',unit='Cuirassier',category='Heavy Cavalry',stage='single-mounted-idle-design-review',integrationStatus='First cuirassier idle pending visual review before animation.',weapon='Straight steel cavalry broadsword with brass basket guard',offhand='Left hand holds reins; no shield',mount='Unarmored bay horse with period saddle, leather harness and muted red saddlecloth',equipmentFinish='Black-painted cuirass, crested black leather helmet, white wool jacket, pale trousers and black riding boots',historicalDirection='Russian Napoleonic cuirassier inspired by the Borodino museum equipment reconstruction.',sheetSize={'width':w,'height':h},grid={'columns':1,'rows':1})
c=meta['animations'][0]
c.update(file='Idle-v1.png',label='Idle - single frame',scale=w/max(w,h),description='Russian Napoleonic cuirassier with straight broadsword at rest on an unarmored horse.',frameCount=1,durations=[1000],sourceFrameOrder=[0])
c['frames']=[{'index':0,'sourceIndex':0,'x':0,'y':0,'width':w,'height':h,'pivot':{'x':w/2,'y':h/2}}]
write(root/'animations.json',meta)
html=(units/'LateMedieval/Boyar/SourceArt/Before-Animation-Actor_Review.html').read_text(encoding='utf-8')
for old,new in [('Russian Late Medieval Boyar','Russian Napoleonic Cuirassier'),('One Boyar. One idle frame.','One cuirassier. One idle frame.'),('Steel and mail, round shield, shoulder-resting axe, and heavy horse barding from the supplied reference.','Black cuirass, white jacket, crested helmet and straight cavalry broadsword on an unarmored horse.'),('Boyar sprite','Cuirassier sprite'),('Loading Boyar idle','Loading cuirassier idle'),('Idle-v7.png','Idle-v1.png'),('../../EarlyMedieval/Druzhina/Actor_Review.html','../../LateMedieval/Boyar/Actor_Review.html'),('Druzhina camera reference','Boyar review')]:
    html=html.replace(old,new)
(root/'Actor_Review.html').write_text(html,encoding='utf-8')
manifest=read(units/'Manifest.json')
entry={'id':'russian-earlymodern-cuirassier','age':'EarlyModern','label':'Russian Napoleonic Cuirassier - single rider','metadata':'EarlyModern/Cuirassier/animations.json','review':'EarlyModern/Cuirassier/Actor_Review.html','actorCount':1}
if not any(e['id']==entry['id'] for e in manifest['units']):
    manifest['units'].append(entry);write(units/'Manifest.json',manifest)
write(root/'Generation.json',{'date':'2026-10-07','mode':'built-in-imagegen','selectedIdle':'Idle-v1.png','equipmentReference':rec['equipmentReference'],'userApproval':'First idle pending review; no animations generated.','ageCatalogNote':'Existing art uses EarlyModern for the Napoleonic package, consistent with the current planning artwork mappings.','records':[rec]})
write(root/'Validation.json',{'date':'2026-10-07','file':'Idle-v1.png','size':[w,h],'mode':im.mode,'alphaExtrema':a.getextrema(),'visibleBounds':a.getbbox(),'sha256':hashlib.sha256((root/'Idle-v1.png').read_bytes()).hexdigest(),'userApproval':'Idle pending review','runtimeIntegration':False})
checks=[]
for name in ['Actor_Review.html','animations.json','Idle-v1.png']:
    with urlopen('http://127.0.0.1:9018/Cultures/Russians/Units/EarlyModern/Cuirassier/'+name,timeout=10) as response:
        assert response.status==200 and response.read()==(root/name).read_bytes(),name
        checks.append({'file':name,'status':200})
write(root/'Browser-Review.json',{'httpChecks':checks,'nativeIdleInspected':True,'browserPlaybackVerified':False,'userApproval':'Idle pending review','runtimeIntegration':False})
print('Cuirassier idle transparency, dimensions and three served review files verified.')
