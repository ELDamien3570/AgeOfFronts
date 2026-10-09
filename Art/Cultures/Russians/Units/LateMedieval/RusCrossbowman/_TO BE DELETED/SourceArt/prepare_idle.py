"""Register the native Rus Crossbowman idle without modifying image pixels."""
from pathlib import Path
from PIL import Image
import json, hashlib, shutil
ROOT=Path(__file__).resolve().parent.parent
UNITS=ROOT.parent.parent
def write(path, data):
    path.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
generation=json.loads((ROOT/'Generation.json').read_text(encoding='utf-8-sig'))
selected=generation['records'][-1]
filename=selected['file']
native_file=selected.get('nativeFile','Native-'+filename)
source=Path(selected['generatedSource'])
shutil.copy2(source,ROOT/'SourceArt'/native_file)
native=Image.open(ROOT/'SourceArt'/native_file)
assert native.mode=='RGBA'
im=Image.new('RGBA',(native.width+48,native.height+48))
im.paste(native,(24,24))
im.save(ROOT/filename)
assert im.mode=='RGBA'
w,h=im.size
alpha=im.getchannel('A')
bounds=alpha.getbbox()
assert bounds and alpha.getextrema()==(0,255)
guard=max(alpha.crop(rect).getextrema()[1] for rect in [(0,0,w,8),(0,h-8,w,h),(0,0,8,h),(w-8,0,w,h)])
assert guard==0
digest=hashlib.sha256((ROOT/filename).read_bytes()).hexdigest()
data=json.loads((UNITS/'ClassicalAge/RecurveArcher/SourceArt/Before-Animation-animations.json').read_text(encoding='utf-8-sig'))
data.update(age='LateMedieval',unit='Rus Crossbowman',weapon='Wooden crossbow with iron-tipped bolt',sheetSize={'width':w,'height':h},integrationStatus='Single idle design awaiting user visual review.')
clip=data['animations'][0]
clip['file']=filename
clip['description']='Conical iron helmet, chainmail over dark purple cloth, tan leather pouches, and wooden crossbow. Reference-based idle design for review.'
clip['frames']=[{'index':0,'x':0,'y':0,'width':w,'height':h,'pivot':{'x':w/2,'y':h/2}}]
write(ROOT/'animations.json',data)
write(ROOT/'Validation.json',{'file':filename,'size':[w,h],'mode':im.mode,'visibleBounds':bounds,'guardAlphaMax':guard,'sha256':digest,'nativePixelsPreserved':True,'transparentPadding':24,'frameCount':1,'failures':[],'userApproval':'Pending idle design review','runtimeIntegration':False})
html=(UNITS/'ClassicalAge/RecurveArcher/Actor_Review.html').read_text(encoding='utf-8')
html=html.replace('Russian Classical Recurve Archer','Russian Late Medieval Rus Crossbowman').replace('Russians · Classical Age','Russians · Late Medieval').replace('One iron archer. Ten motions.','Rus Crossbowman. First look.').replace('Early iron armor over leather, cream fur, and a recurve bow.','Chainmail over purple cloth, conical helmet, leather gear, and a wooden crossbow.').replace('Single actor animation review','Single idle design review').replace('Enlarged single iron recurve archer sprite','Enlarged single Rus Crossbowman sprite').replace('../../BronzeAge/RiverArcher/Actor_Review.html','../../ClassicalAge/RecurveArcher/Actor_Review.html').replace('Bronze archer reference','Classical archer reference')
(ROOT/'Actor_Review.html').write_text(html.replace('href="Idle-v1.png"','href="'+filename+'"'),encoding='utf-8')
manifest_path=UNITS/'manifest.json'
manifest=json.loads(manifest_path.read_text(encoding='utf-8-sig'))
if not any(unit['id']=='russian-latemedieval-rus-crossbowman' for unit in manifest['units']):
    manifest['units'].append({'id':'russian-latemedieval-rus-crossbowman','age':'LateMedieval','label':'Russian Rus Crossbowman - single soldier','metadata':'LateMedieval/RusCrossbowman/animations.json','review':'LateMedieval/RusCrossbowman/Actor_Review.html','actorCount':1})
    write(manifest_path,manifest)
print(f'Native idle registered: {w}x{h}; alpha guards clear.')

