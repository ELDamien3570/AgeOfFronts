"""Register the native musketeer idle with transparent padding and solo review."""
from pathlib import Path
from PIL import Image
import hashlib,json,shutil
ROOT=Path(__file__).resolve().parent.parent
UNITS=ROOT.parent.parent
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,d):p.write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
record=read(ROOT/'Generation.json')['records'][-1]
native_path=ROOT/'SourceArt'/record['nativeFile'];shutil.copy2(record['generatedSource'],native_path)
native=Image.open(native_path);assert native.mode=='RGBA'
im=Image.new('RGBA',(native.width+48,native.height+48));im.paste(native,(24,24));im.save(ROOT/record['file'])
w,h=im.size;a=im.getchannel('A');assert a.getbbox()
guard=max(a.crop(r).getextrema()[1] for r in [(0,0,w,8),(0,h-8,w,h),(0,0,8,h),(w-8,0,w,h)]);assert guard==0
data=read(UNITS/'LateMedieval/RusCrossbowman/SourceArt/Before-Animation-animations.json')
data.update(age='EarlyModern',unit='Early Rus Musketeer',weapon='Early matchlock musket',sheetSize={'width':w,'height':h},integrationStatus='Single idle design pending user visual approval.')
clip=data['animations'][0];clip.update(file=record['file'],description='Streltsy-inspired red caftan, fur-trimmed cap, wooden powder-charge belt, and long matchlock musket held low.',frames=[{'index':0,'x':0,'y':0,'width':w,'height':h,'pivot':{'x':w/2,'y':h/2}}])
write(ROOT/'animations.json',data)
write(ROOT/'Validation.json',{'file':record['file'],'size':[w,h],'mode':'RGBA','frameCount':1,'guardAlphaMax':guard,'visibleBounds':a.getbbox(),'sha256':hashlib.sha256((ROOT/record['file']).read_bytes()).hexdigest(),'nativePixelsPreserved':True,'transparentPadding':24,'failures':[],'runtimeIntegration':False,'userApproval':'Pending idle review'})
html=(UNITS/'LateMedieval/RusCrossbowman/Actor_Review.html').read_text(encoding='utf-8-sig')
html=html.replace('Russian Late Medieval Rus Crossbowman','Russian Early Modern Rus Musketeer').replace('Russians · Late Medieval','Russians · Early Modern').replace('Rus Crossbowman. Ten motions.','Early Rus Musketeer. First look.').replace('Chainmail over purple cloth, conical helmet, leather gear, and a wooden crossbow.','Red caftan, fur-trimmed cap, powder-charge belt, and matchlock musket.').replace('Solo animation review','Single idle design review').replace('single Rus Crossbowman sprite','single Rus Musketeer sprite').replace('../../ClassicalAge/RecurveArcher/Actor_Review.html','../../LateMedieval/RusCrossbowman/Actor_Review.html').replace('Classical archer reference','Crossbowman reference')
(ROOT/'Actor_Review.html').write_text(html,encoding='utf-8')
manifest_path=UNITS/'manifest.json';manifest=read(manifest_path)
if not any(u['id']=='russian-earlymodern-rus-musketeer' for u in manifest['units']):
    manifest['units'].append({'id':'russian-earlymodern-rus-musketeer','age':'EarlyModern','label':'Russian Early Rus Musketeer - single soldier','metadata':'EarlyModern/RusMusketeer/animations.json','review':'EarlyModern/RusMusketeer/Actor_Review.html','actorCount':1});write(manifest_path,manifest)
print('Musketeer single idle registered; native pixels preserved; alpha guards clear.')
