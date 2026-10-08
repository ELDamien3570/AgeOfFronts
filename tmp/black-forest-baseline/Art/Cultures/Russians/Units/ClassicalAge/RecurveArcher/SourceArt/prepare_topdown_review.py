from pathlib import Path
from PIL import Image
import json,shutil,hashlib
root=Path(__file__).resolve().parent.parent
review=root/'TopDownReview';review.mkdir(exist_ok=True)
record=json.loads((root/'SourceArt'/'TopDown-Generation-v3.json').read_text())
native=root/'SourceArt'/record['nativeFile'];shutil.copy2(record['generatedSource'],native)
im=Image.open(native).convert('RGBA');out=Image.new('RGBA',(im.width+48,im.height+48));out.paste(im,(24,24))
out.save(review/'Idle-TopDown-v3.png');w,h=out.size
data=json.loads((root/'animations.json').read_text(encoding='utf-8-sig'))
data.update({'stage':'overhead-idle-review','sheetSize':{'width':w,'height':h},'grid':{'columns':1,'rows':1},'animations':[{'id':'idle','file':'Idle-TopDown-v3.png','label':'Overhead idle','loop':True,'scale':1,'durations':[1000],'frameCount':1,'description':'Review the steeper overhead Recurve Archer pose before animation.','frames':[{'index':0,'x':0,'y':0,'width':w,'height':h,'pivot':{'x':w/2,'y':h/2}}]}]})
for key in ['shotSequence','chargeShotSequence']:data.pop(key,None)
(review/'animations.json').write_text(json.dumps(data,indent=2)+'\n')
html=(root/'Actor_Review.html').read_text(encoding='utf-8-sig').replace('../../StoneAge/Clubman/actor-review.js','../../../StoneAge/Clubman/actor-review.js').replace('Recurve Bowmen · single actor preview','Recurve Archer · overhead idle').replace('Single actor animation review','Overhead idle review')
(review/'Actor_Review.html').write_text(html,encoding='utf-8')
(review/'Generation.json').write_text(json.dumps(record,indent=2)+'\n')
a=out.getchannel('A');guard=max(a.crop(r).getextrema()[1] for r in [(0,0,w,8),(0,h-8,w,h),(0,0,8,h),(w-8,0,w,h)]);assert guard==0
(review/'Validation.json').write_text(json.dumps({'frameCount':1,'guardAlphaMax':guard,'nativeSha256':hashlib.sha256(native.read_bytes()).hexdigest(),'priorAnimationsPreserved':True,'userApproval':'Pending idle review','runtimeIntegration':False},indent=2)+'\n')
print('Prepared overhead Recurve Archer idle review.')


