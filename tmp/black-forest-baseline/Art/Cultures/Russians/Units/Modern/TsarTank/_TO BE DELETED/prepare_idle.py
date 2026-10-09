"""Publish the first Tsar Tank-inspired Russian vehicle idle without changing base art."""
from pathlib import Path
from PIL import Image
from urllib.request import urlopen
import json, shutil, hashlib

ROOT=Path(__file__).resolve().parent
UNITS=ROOT.parent.parent
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,v): p.write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
rec=read(ROOT/'SourceArt/Generation-idle-v1.json')
native=ROOT/'SourceArt/Native-Idle-v1.png'
shutil.copy2(rec['generatedSource'],native);shutil.copy2(native,ROOT/'Idle-v1.png')
im=Image.open(native);w,h=im.size
assert im.mode=='RGBA'
a=im.getchannel('A');bounds=a.point(lambda v:255 if v>16 else 0).getbbox()
assert a.getextrema()[0]==0 and a.getextrema()[1]>=240
assert bounds and bounds[0]>0 and bounds[1]>0 and bounds[2]<w and bounds[3]<h
assert all(a.getpixel(p)==0 for p in [(0,0),(w-1,0),(0,h-1),(w-1,h-1)])
digest=hashlib.sha256(native.read_bytes()).hexdigest()
description='Tsar Tank-inspired tricycle: two giant upright steel wheels, a broad riveted hull, and a small rear steering roller on a long tail boom.'
meta={'schemaVersion':1,'cultureId':'russians','age':'Modern','unit':'Tsar Tank','category':'Armored Vehicle','actorCount':1,'stage':'single-vehicle-idle-design-review','integrationStatus':'First idle pending review before animation; gameplay integration is separate.','camera':'vertical-overhead-orthographic','facing':'screen-down','sheetSize':{'width':w,'height':h},'grid':{'columns':1,'rows':1},'reviewFootprint':400,'registration':'Fixed vehicle-root pivot and constant scale.','historicalEra':'WWI-inspired imagined Soviet faction variant','historicalDirection':'User selected the Imperial Russian Tsar Tank giant tricycle as the design basis. Soviet paint and markings are a fictional faction adaptation.','designReference':'https://www.nevingtonwarmuseum.com/tsar-lebedenko-tank.html','weapon':'Short cannon barrels in side sponsons','animations':[{'id':'idle','file':'Idle-v1.png','sha256':digest,'label':'Idle - single frame','loop':True,'scale':w/max(w,h),'durations':[1000],'description':description,'frameCount':1,'sourceFrameOrder':[0],'frames':[{'index':0,'sourceIndex':0,'x':0,'y':0,'width':w,'height':h,'pivot':{'x':w/2,'y':h/2}}]}]}
write(ROOT/'animations.json',meta)
html=(UNITS/'Modern/MachineGunTruck/SourceArt/Before-Animation-Actor_Review.html').read_text(encoding='utf-8-sig')
for old,new in [('Soviet Machine Gun Truck','Russian Tsar Tank'),('Modern Age · World War II','Modern Age · WWI-inspired'),('One machine gun truck. One idle frame.','One Tsar Tank. One idle frame.'),('Olive-drab Soviet-style cargo truck with an open wooden bed, one pedestal-mounted heavy machine gun and a khaki-clad gunner.',description),('machine gun truck sprite','Tsar Tank sprite'),('Loading truck idle','Loading Tsar Tank idle'),('Idle-v3.png','Idle-v1.png'),('../SovietMachineGunner/Actor_Review.html','../MachineGunTruck/Actor_Review.html'),('Soviet machine gunner review','Machine gun truck review')]:
    html=html.replace(old,new)
(ROOT/'Actor_Review.html').write_text(html,encoding='utf-8')
manifest=read(UNITS/'Manifest.json')
entry={'id':'russian-modern-tsar-tank','age':'Modern','label':'Russian Tsar Tank - single vehicle','metadata':'Modern/TsarTank/animations.json','review':'Modern/TsarTank/Actor_Review.html','actorCount':1}
assert not any(e['id']==entry['id'] for e in manifest['units'])
manifest['units'].append(entry);write(UNITS/'Manifest.json',manifest)
write(ROOT/'Generation.json',{'date':'2026-10-07','mode':'built-in-imagegen','selectedIdle':'Idle-v1.png','userApproval':'First idle pending visual review. User selected Tsar Tank giant tricycle design.','designReference':meta['designReference'],'records':[rec]})
write(ROOT/'Validation.json',{'file':'Idle-v1.png','size':[w,h],'mode':im.mode,'alphaExtrema':a.getextrema(),'visibleBounds':bounds,'sha256':digest,'runtimeIntegration':False,'userApproval':'Idle pending review'})
checks=[]
for name in ['Actor_Review.html','animations.json','Idle-v1.png']:
    with urlopen('http://127.0.0.1:9018/Cultures/Russians/Units/Modern/TsarTank/'+name,timeout=10) as response:
        assert response.status==200 and response.read()==(ROOT/name).read_bytes()
        checks.append({'file':name,'status':200})
write(ROOT/'Browser-Review.json',{'httpChecks':checks,'nativeIdleInspected':True,'browserPlaybackVerified':False,'runtimeIntegration':False,'userApproval':'Idle pending review'})
print('Tsar Tank idle alpha, bounds and three served review files verified.')
