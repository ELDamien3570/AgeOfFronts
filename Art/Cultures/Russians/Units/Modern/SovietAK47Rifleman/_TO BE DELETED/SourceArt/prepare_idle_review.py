"""Preserve native Soviet AK-47 idle and prepare its standalone review."""
from pathlib import Path
from PIL import Image
import json, shutil, hashlib, urllib.request
root=Path(__file__).resolve().parent.parent
record=json.loads((root/'Generation.json').read_text())
source=root/'SourceArt'/record['nativeFile']
shutil.copy2(record['generatedSource'],source)
im=Image.open(source).convert('RGBA')
out=Image.new('RGBA',(im.width+48,im.height+48))
out.paste(im,(24,24))
out.save(root/record['file'])
w,h=out.size
data={'schemaVersion':1,'cultureId':'russians','age':'Modern','unit':'Soviet AK-47 Rifleman','category':'Ranged','actorCount':1,'stage':'single-idle-design-review','integrationStatus':'Local art review; animation follows approved idle.','camera':'vertical-overhead-orthographic','facing':'screen-down','sheetSize':{'width':w,'height':h},'grid':{'columns':1,'rows':1},'reviewFootprint':360,'weapon':'Wood-stock AK-47','animations':[{'id':'idle','file':record['file'],'label':'Idle design','loop':True,'scale':1,'durations':[1000],'frameCount':1,'description':'Review the Soviet uniform, overhead silhouette and AK-47 carry before animation.','frames':[{'index':0,'x':0,'y':0,'width':w,'height':h,'pivot':{'x':w/2,'y':h/2}}]}]}
(root/'animations.json').write_text(json.dumps(data,indent=2)+'\n')
html=(root.parent/'SovietMachineGunner'/'Actor_Review.html').read_text(encoding='utf-8-sig')
html=html.replace('DP-28 Crew','Soviet AK-47 Rifleman').replace('Steel helmet, khaki uniform, canvas gear, and a DP-28 light machine gun.','Olive field uniform, steel helmet, canvas gear, and a wood-stock AK-47.').replace('Solo animation review','Solo idle design review').replace('Loading Soviet gunner animations…','Loading Soviet rifleman idle…').replace('href="Idle-v1.png"','href="'+record['file']+'"')
(root/'Actor_Review.html').write_text(html,encoding='utf-8')
a=out.getchannel('A')
guard=max(a.crop(r).getextrema()[1] for r in [(0,0,w,8),(0,h-8,w,h),(0,0,8,h),(w-8,0,w,h)])
assert guard==0
assert a.getextrema()==(0,255)
(root/'Validation.json').write_text(json.dumps({'frameCount':1,'guardAlphaMax':guard,'nativeSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'userApproval':'Pending idle review','runtimeIntegration':False},indent=2)+'\n')
base='http://127.0.0.1:9007/Cultures/Russians/Units/Modern/SovietAK47Rifleman/'
checks=[]
for name in ['Actor_Review.html','animations.json',record['file'],'../../StoneAge/Clubman/actor-review.js']:
    with urllib.request.urlopen(base+name) as response:
        assert response.status==200
        checks.append({'file':name,'status':response.status,'bytes':len(response.read())})
(root/'Browser-Review.json').write_text(json.dumps({'httpChecks':checks,'browserPlaybackVerified':False,'userApproval':'Pending idle review'},indent=2)+'\n')
print('Prepared single Soviet AK-47 idle; transparent borders and served resources pass.')

