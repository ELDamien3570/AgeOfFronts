"""Preserve native art and register the Soviet DP-28 single idle review."""
from pathlib import Path
from PIL import Image
import hashlib,json,shutil
ROOT=Path(__file__).resolve().parent.parent
UNITS=ROOT.parent.parent
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,d):p.write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
record=read(ROOT/'Generation.json')['records'][-1]
native_path=ROOT/'SourceArt'/record['nativeFile']
shutil.copy2(record['generatedSource'],native_path)
native=Image.open(native_path)
assert native.mode=='RGBA'
im=Image.new('RGBA',(native.width+48,native.height+48));im.paste(native,(24,24));im.save(ROOT/record['file'])
w,h=im.size;a=im.getchannel('A');assert a.getbbox()
guard=max(a.crop(r).getextrema()[1] for r in [(0,0,w,8),(0,h-8,w,h),(0,0,8,h),(w-8,0,w,h)])
assert guard==0
data={'schemaVersion':1,'cultureId':'russians','age':'Modern','unit':'Soviet DP-28 Machine Gunner','category':'Ranged','actorCount':1,'stage':'single-idle-design-review','integrationStatus':'Single idle pending user visual approval; runtime integration separate.','camera':'vertical-overhead-orthographic','facing':'screen-down','sheetSize':{'width':w,'height':h},'grid':{'columns':1,'rows':1},'reviewFootprint':400,'registration':'Fixed authored torso root; no silhouette fitting.','weapon':'DP-28 light machine gun','animations':[{'id':'idle','file':record['file'],'label':'Idle - single frame','loop':True,'scale':1,'durations':[1000],'description':'Soviet steel helmet, khaki uniform, canvas gear and a DP-28 with a top-mounted pan magazine.','frameCount':1,'frames':[{'index':0,'x':0,'y':0,'width':w,'height':h,'pivot':{'x':w/2,'y':h/2}}]}]}
write(ROOT/'animations.json',data)
write(ROOT/'Validation.json',{'file':record['file'],'size':[w,h],'mode':'RGBA','frameCount':1,'guardAlphaMax':guard,'visibleBounds':a.getbbox(),'sha256':hashlib.sha256((ROOT/record['file']).read_bytes()).hexdigest(),'nativePixelsPreserved':True,'transparentPadding':24,'failures':[],'runtimeIntegration':False,'userApproval':'Pending idle review'})
html=(UNITS/'EarlyModern/RusMusketeer/Actor_Review.html').read_text(encoding='utf-8-sig')
html=html.replace('Russian Early Modern Rus Musketeer','Russian Modern Soviet DP-28 Machine Gunner').replace('Russians · Early Modern','Russians · Modern Age').replace('Early Rus Musketeer. Ten motions.','Soviet DP-28 Gunner. First look.').replace('Red caftan, fur-trimmed cap, powder-charge belt, and matchlock musket.','Steel helmet, khaki uniform, canvas gear, and a DP-28 light machine gun.').replace('Solo animation review','Single idle design review').replace('single Rus Musketeer sprite','single Soviet machine gunner sprite').replace('Loading archer animation sheets…','Loading Soviet gunner idle…').replace('Idle-Lowered-v3.png','Idle-v1.png').replace('../../LateMedieval/RusCrossbowman/Actor_Review.html','../../EarlyModern/RusMusketeer/Actor_Review.html').replace('Crossbowman reference','Musketeer reference')
(ROOT/'Actor_Review.html').write_text(html,encoding='utf-8')
manifest_path=UNITS/'manifest.json';manifest=read(manifest_path)
if not any(u['id']=='russian-modern-soviet-dp28-gunner' for u in manifest['units']):
    manifest['units'].append({'id':'russian-modern-soviet-dp28-gunner','age':'Modern','label':'Soviet DP-28 machine gunner - single soldier','metadata':'Modern/SovietMachineGunner/animations.json','review':'Modern/SovietMachineGunner/Actor_Review.html','actorCount':1})
    write(manifest_path,manifest)
print('Soviet DP-28 idle registered; native pixels preserved; transparent guards passed.')
