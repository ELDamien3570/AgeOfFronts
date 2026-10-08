import json, hashlib, shutil
from pathlib import Path
from PIL import Image
p=Path(__file__).parent
source=Path('C:/Users/Damien/.codex/generated_images/01a11641-9e1b-7c81-be76-c9edd53ef182/exec-4be28c34-53b8-4602-8b98-a96c302c1f87.png')
shutil.copyfile(source,p/'Idle-v3.png')
def save(n,d): (p/n).write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
m=json.loads((p/'animations.json').read_text())
m['animations'][0]['file']='Idle-v3.png'
m['bowstring']='One taut line on inside of anatomical left arm; naturally occluded by forearm'
save('animations.json',m)
g=json.loads((p/'Generation.json').read_text())
g['records'][-1]['status']='superseded-string-correction-source-preserved'
g['records'].append({'id':'russian-classicalage-horse-archer-idle-v3-string','file':'Idle-v3.png','clip':'idle','prompt':(p/'String-Correction-Prompt.txt').read_text().strip(),'references':['Idle-v2.png'],'generatedSource':str(source),'status':'selected-idle-design-review'})
save('Generation.json',g)
im=Image.open(p/'Idle-v3.png'); a=im.getchannel('A')
assert im.size==(1254,1254) and im.mode=='RGBA'
edge=max(a.crop(box).getextrema()[1] for box in [(0,0,1254,1),(0,1253,1254,1254),(0,0,1,1254),(1253,0,1254,1254)])
assert edge==0
save('Validation.json',{'date':'2026-10-07','file':'Idle-v3.png','size':im.size,'mode':im.mode,'visibleBounds':a.getbbox(),'edgeGuardAlphaMax':edge,'nativeSourcePreserved':True,'sha256':hashlib.sha256((p/'Idle-v3.png').read_bytes()).hexdigest(),'userApproval':'Pending corrected idle review','runtimeIntegration':False})
r=(p/'README.md').read_text().replace('`Idle-v2.png` is the current','`Idle-v3.png` is the current').replace('corrected to hold the bow','corrected to run the taut string inside the arm and hold the bow').replace('`Review-Idle-v2.png`','`Review-Idle-v3.png`')
(p/'README.md').write_text(r,encoding='utf-8')
print('Native corrected string idle saved and registered.')
