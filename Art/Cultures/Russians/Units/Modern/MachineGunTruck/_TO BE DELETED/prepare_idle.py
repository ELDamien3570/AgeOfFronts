"""Publish a Soviet-style WWII machine-gun truck idle for local design review."""
from pathlib import Path
from PIL import Image
from urllib.request import urlopen
import json, hashlib, shutil

ROOT=Path(__file__).resolve().parent
UNITS=ROOT.parent.parent
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,v): p.write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
record=read(ROOT/'SourceArt/Generation-idle-v1.json')
native=ROOT/'SourceArt/Native-Idle-v1.png'
shutil.copy2(record['generatedSource'],native)
shutil.copy2(native,ROOT/'Idle-v1.png')
im=Image.open(native);w,h=im.size
assert im.mode=='RGBA'
a=im.getchannel('A')
assert a.getextrema()[0]==0 and a.getextrema()[1]>=240
assert all(a.getpixel(p)==0 for p in [(0,0),(w-1,0),(0,h-1),(w-1,h-1)])
bounds=a.point(lambda v:255 if v>16 else 0).getbbox()
assert bounds and bounds[0]>0 and bounds[1]>0 and bounds[2]<w and bounds[3]<h
digest=hashlib.sha256(native.read_bytes()).hexdigest()
description='Olive-drab Soviet-style cargo truck with an open wooden bed, one pedestal-mounted heavy machine gun and a khaki-clad gunner.'
clip={'id':'idle','file':'Idle-v1.png','sha256':digest,'label':'Idle - single frame','loop':True,'scale':w/max(w,h),'durations':[1000],'description':description,'frameCount':1,'sourceFrameOrder':[0],'frames':[{'index':0,'sourceIndex':0,'x':0,'y':0,'width':w,'height':h,'pivot':{'x':w/2,'y':h/2}}]}
meta={'schemaVersion':1,'cultureId':'russians','age':'Modern','unit':'Machine Gun Truck','category':'Ranged Vehicle','actorCount':1,'stage':'single-vehicle-idle-design-review','integrationStatus':'First idle pending visual review before animation. Runtime integration is separate.','camera':'vertical-overhead-orthographic','facing':'screen-down','sheetSize':{'width':w,'height':h},'grid':{'columns':1,'rows':1},'reviewFootprint':400,'registration':'Fixed vehicle root pivot and constant scale.','weapon':'Single pedestal-mounted DShK-inspired heavy machine gun','historicalEra':'World War II','historicalDirection':'Soviet ZiS-5-inspired cargo truck with a heavy machine gun; stylized gameplay design, not an exact museum reconstruction.','designReference':'https://www.landmarkscout.com/zis-5-russian-truck/','animations':[clip]}
write(ROOT/'animations.json',meta)
html=(UNITS/'EarlyModern/Cuirassier/SourceArt/Before-Animation-Actor_Review.html').read_text(encoding='utf-8')
for old,new in [('Russian Napoleonic Cuirassier','Soviet Machine Gun Truck'),('Late Medieval Age','Modern Age · World War II'),('One cuirassier. One idle frame.','One machine gun truck. One idle frame.'),('Black cuirass, white jacket, crested helmet and straight cavalry broadsword on an unarmored horse.',description),('Single mounted actor review','Single vehicle review'),('Cuirassier sprite','machine gun truck sprite'),('Loading cuirassier idle','Loading truck idle'),('single actor','single vehicle'),('same single actor','same single vehicle'),('../../LateMedieval/Boyar/Actor_Review.html','../SovietMachineGunner/Actor_Review.html'),('Boyar review','Soviet machine gunner review')]:
    html=html.replace(old,new)
(ROOT/'Actor_Review.html').write_text(html,encoding='utf-8')
manifest=read(UNITS/'Manifest.json')
entry={'id':'russian-modern-machine-gun-truck','age':'Modern','label':'Soviet Machine Gun Truck - single vehicle','metadata':'Modern/MachineGunTruck/animations.json','review':'Modern/MachineGunTruck/Actor_Review.html','actorCount':1}
assert not any(e['id']==entry['id'] for e in manifest['units']),'Catalog entry already exists'
manifest['units'].append(entry);write(UNITS/'Manifest.json',manifest)
write(ROOT/'Generation.json',{'date':'2026-10-07','mode':'built-in-imagegen','selectedIdle':'Idle-v1.png','userApproval':'User requested WWII Soviet-looking truck and selected one heavy machine gun. First idle pending review.','designReference':meta['designReference'],'records':[record]})
write(ROOT/'Validation.json',{'file':'Idle-v1.png','size':[w,h],'mode':im.mode,'alphaExtrema':a.getextrema(),'visibleBounds':bounds,'sha256':digest,'runtimeIntegration':False,'userApproval':'Idle pending review'})
checks=[]
for name in ['Actor_Review.html','animations.json','Idle-v1.png']:
    with urlopen('http://127.0.0.1:9018/Cultures/Russians/Units/Modern/MachineGunTruck/'+name,timeout=10) as response:
        assert response.status==200 and response.read()==(ROOT/name).read_bytes()
        checks.append({'file':name,'status':200})
write(ROOT/'Browser-Review.json',{'httpChecks':checks,'nativeIdleInspected':True,'browserPlaybackVerified':False,'runtimeIntegration':False,'userApproval':'Idle pending review'})
print('Truck idle transparency, dimensions, frame bounds and served review assets verified.')

