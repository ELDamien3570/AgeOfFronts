"""Register a camera revision without replacing the approved animation set."""
from pathlib import Path
from PIL import Image
import json,hashlib,shutil,sys
root=Path(__file__).resolve().parent.parent
review=root/'TopDownReview'
review.mkdir(exist_ok=True)
version=sys.argv[1] if len(sys.argv)>1 else 'v2'
record_name='TopDown-Generation.json' if version=='v2' else f'TopDown-Generation-{version}.json'
record=json.loads((root/'SourceArt'/record_name).read_text(encoding='utf-8-sig'))
native=root/'SourceArt'/f'Native-Idle-TopDown-{version}.png'
shutil.copy2(record['generatedSource'],native)
im=Image.open(native).convert('RGBA')
out=Image.new('RGBA',(im.width+48,im.height+48))
out.paste(im,(24,24))
out.save(review/f'Idle-TopDown-{version}.png')
w,h=out.size
data=json.loads((root/'animations.json').read_text(encoding='utf-8-sig'))
data.update({'stage':'overhead-idle-camera-review','sheetSize':{'width':w,'height':h},'grid':{'columns':1,'rows':1},'camera':'vertical-overhead-orthographic','animations':[{'id':'idle','file':f'Idle-TopDown-{version}.png','label':'Overhead idle - design review','loop':True,'scale':1,'durations':[1000],'frameCount':1,'description':'Steeper overhead camera revision. Review this pose before rebuilding the animation set.','frames':[{'index':0,'x':0,'y':0,'width':w,'height':h,'pivot':{'x':w/2,'y':h/2}}]}]})
for key in ['shotSequence','chargeShotSequence']:data.pop(key,None)
(review/'animations.json').write_text(json.dumps(data,indent=2)+'\n')
html=(root/'Actor_Review.html').read_text(encoding='utf-8-sig')
html=html.replace('../Clubman/actor-review.js','../../Clubman/actor-review.js').replace('Idle.png',f'Idle-TopDown-{version}.png')
html=html.replace('One javelinist. Nine motions.','Javelinist · overhead idle revision').replace('Review the overarm throws and separate javelin reload.','Review the steeper overhead pose before animation.').replace('Single actor prototype','Overhead camera review')
(review/'Actor_Review.html').write_text(html,encoding='utf-8')
(review/'Generation.json').write_text(json.dumps(record,indent=2)+'\n')
a=out.getchannel('A')
edge=max(a.crop(r).getextrema()[1] for r in [(0,0,w,8),(0,h-8,w,h),(0,0,8,h),(w-8,0,w,h)])
assert edge==0
(review/'Validation.json').write_text(json.dumps({'frameCount':1,'size':[w,h],'guardAlphaMax':edge,'nativeSha256':hashlib.sha256(native.read_bytes()).hexdigest(),'userApproval':'Pending overhead pose review','originalAnimationsPreserved':True,'runtimeIntegration':False},indent=2)+'\n')
print('Prepared separate overhead idle review; existing animations preserved.')
