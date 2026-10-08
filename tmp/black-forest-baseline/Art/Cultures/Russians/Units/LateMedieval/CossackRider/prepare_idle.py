"""Publish the first Cossack Rider idle for local visual review."""
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
shutil.copy2(units/'EarlyMedieval/CossackRider/SourceArt/User-Clothing-Reference.png',root/'SourceArt/User-Clothing-Reference.png')
im=Image.open(root/'Idle-v1.png');w,h=im.size;a=im.getchannel('A')
assert im.mode=='RGBA' and a.getextrema()[0]==0 and a.getextrema()[1]>=240
assert all(a.getpixel(pt)==0 for pt in [(0,0),(w-1,0),(0,h-1),(w-1,h-1)])
meta=read(units/'EarlyModern/Cuirassier/SourceArt/Before-Animation-animations.json')
meta.update(age='LateMedieval',unit='Cossack Rider',category='Light Cavalry',stage='single-mounted-idle-design-review',integrationStatus='First idle pending visual review before animation.',weapon='Wooden lance with narrow steel spearhead held at rest in right hand',offhand='Left hand holds reins; no shield',mount='Unarmored bay horse with simple leather harness, saddle and gray blanket roll',equipmentFinish='Dark leather and iron lamellar vest, modest steel shoulder caps, mail collar and iron bracers over dark coat; blue trousers, boots and fur cap retained',historicalDirection='Imagined Late Medieval successor to the approved Early Medieval Cossack Rider, with modest iron protection added.',sheetSize={'width':w,'height':h},grid={'columns':1,'rows':1})
meta.pop('historicalEra',None)
c=meta['animations'][0]
c.update(file='Idle-v1.png',label='Idle - single frame',scale=w/max(w,h),description='Lightly armored Cossack Rider with resting lance on an unarmored bay horse.',frameCount=1,durations=[1000],sourceFrameOrder=[0])
c['frames']=[{'index':0,'sourceIndex':0,'x':0,'y':0,'width':w,'height':h,'pivot':{'x':w/2,'y':h/2}}]
write(root/'animations.json',meta)
html=(units/'EarlyModern/Cuirassier/SourceArt/Before-Animation-Actor_Review.html').read_text(encoding='utf-8')
for old,new in [('Russian Napoleonic Cuirassier','Russian Early Medieval Cossack Rider'),('One cuirassier. One idle frame.','One Cossack Rider. One idle frame.'),('Black cuirass, white jacket, crested helmet and straight cavalry broadsword on an unarmored horse.','Light iron armor over dark riding coat, blue trousers, fur cap and resting lance on an unarmored horse.'),('Cuirassier sprite','Cossack Rider sprite'),('Loading cuirassier idle','Loading Cossack Rider idle'),('../../LateMedieval/Boyar/Actor_Review.html','../../EarlyMedieval/CossackRider/Actor_Review.html'),('Boyar review','Early Medieval Cossack Rider')]:
    html=html.replace(old,new)
(root/'Actor_Review.html').write_text(html,encoding='utf-8')
manifest=read(units/'Manifest.json')
entry={'id':'russian-latemedieval-cossack-rider','age':'LateMedieval','label':'Russian Late Medieval Cossack Rider - single rider','metadata':'LateMedieval/CossackRider/animations.json','review':'LateMedieval/CossackRider/Actor_Review.html','actorCount':1}
if not any(e['id']==entry['id'] for e in manifest['units']):
    manifest['units'].append(entry);write(units/'Manifest.json',manifest)
write(root/'Generation.json',{'date':'2026-10-07','mode':'built-in-imagegen','selectedIdle':'Idle-v1.png','referenceCopy':'SourceArt/User-Clothing-Reference.png','userApproval':'User requested a slightly more armored Late Medieval successor to the approved Early Medieval Cossack Rider. First idle pending review; no animations generated.','records':[rec]})
write(root/'Validation.json',{'date':'2026-10-07','file':'Idle-v1.png','size':[w,h],'mode':im.mode,'alphaExtrema':a.getextrema(),'visibleBounds':a.getbbox(),'sha256':hashlib.sha256((root/'Idle-v1.png').read_bytes()).hexdigest(),'userApproval':'Idle pending review','runtimeIntegration':False})
checks=[]
for name in ['Actor_Review.html','animations.json','Idle-v1.png']:
    with urlopen('http://127.0.0.1:9018/Cultures/Russians/Units/LateMedieval/CossackRider/'+name,timeout=10) as response:
        assert response.status==200 and response.read()==(root/name).read_bytes(),name
        checks.append({'file':name,'status':200})
write(root/'Browser-Review.json',{'httpChecks':checks,'nativeIdleInspected':True,'browserPlaybackVerified':False,'userApproval':'Idle pending review','runtimeIntegration':False})
print('Cossack Rider idle transparency, dimensions and three served review files verified.')
