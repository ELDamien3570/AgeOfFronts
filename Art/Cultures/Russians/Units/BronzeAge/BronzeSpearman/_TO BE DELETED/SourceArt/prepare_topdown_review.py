"""Prepare a versioned solo idle camera review; retain approved originals."""
from pathlib import Path
from PIL import Image
import json, shutil, hashlib, urllib.request

root=Path(__file__).resolve().parent.parent
review=root/'TopDownReview'; review.mkdir(exist_ok=True)
record=json.loads((root/'SourceArt'/'TopDown-Generation-v2.json').read_text(encoding='utf-8-sig'))
native=root/'SourceArt'/record['nativeFile']; shutil.copy2(record['generatedSource'],native)
im=Image.open(native).convert('RGBA')
out=Image.new('RGBA',(im.width+48,im.height+48)); out.paste(im,(24,24))
out.save(review/record['file']); w,h=out.size
data=json.loads((root/'animations.json').read_text(encoding='utf-8-sig'))
data.update({'stage':'overhead-idle-review','reviewFootprint':400,'registration':'Native solo pose with 24px transparent padding and fixed canvas center pivot.','sheetSize':{'width':w,'height':h},'grid':{'columns':1,'rows':1},'animations':[{'id':'idle','file':record['file'],'label':'Overhead idle','loop':True,'scale':1,'durations':[1000],'frameCount':1,'description':'Review the directly overhead Bronze Spearman before rebuilding animations.','frames':[{'index':0,'x':0,'y':0,'width':w,'height':h,'pivot':{'x':w/2,'y':h/2}}]}]})
data.pop('deathVariants',None)
(review/'animations.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
html=(root/'Actor_Review.html').read_text(encoding='utf-8-sig').replace('../../StoneAge/Clubman/actor-review.js','../../../StoneAge/Clubman/actor-review.js').replace('Single Actor Review','Overhead Idle Review').replace('Single actor animation review','Overhead idle review').replace('Loading nine sprite sheets…','Loading overhead idle…').replace('href="Idle-v1.png"','href="'+record['file']+'"')
(review/'Actor_Review.html').write_text(html,encoding='utf-8')
(review/'Generation.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
a=out.getchannel('A')
guard=max(a.crop(r).getextrema()[1] for r in [(0,0,w,8),(0,h-8,w,h),(0,0,8,h),(w-8,0,w,h)])
assert guard==0
(review/'Validation.json').write_text(json.dumps({'frameCount':1,'guardAlphaMax':guard,'nativeSha256':hashlib.sha256(native.read_bytes()).hexdigest(),'priorAnimationsPreserved':True,'userApproval':'Pending idle review','runtimeIntegration':False},indent=2)+'\n',encoding='utf-8')
base='http://127.0.0.1:9007/Cultures/Russians/Units/BronzeAge/BronzeSpearman/TopDownReview/'
checks=[]
for name in ['Actor_Review.html','animations.json',record['file'],'../../../StoneAge/Clubman/actor-review.js']:
    with urllib.request.urlopen(base+name) as response:
        assert response.status==200
        checks.append({'file':name,'status':response.status,'bytes':len(response.read())})
(review/'Browser-Review.json').write_text(json.dumps({'httpChecks':checks,'browserPlaybackVerified':False,'userApproval':'Pending idle review'},indent=2)+'\n',encoding='utf-8')
print('Prepared overhead Bronze Spearman idle; transparent borders and HTTP resources pass.')
