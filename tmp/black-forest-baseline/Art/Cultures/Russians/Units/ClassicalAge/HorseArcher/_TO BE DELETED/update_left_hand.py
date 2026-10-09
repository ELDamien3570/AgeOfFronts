import json, hashlib
from pathlib import Path
from PIL import Image

p = Path(__file__).parent
def save(name, data):
    (p/name).write_text(json.dumps(data, indent=2)+'\n', encoding='utf-8')
m = json.loads((p/'animations.json').read_text())
m['weaponHand'] = 'Anatomical left (screen-right when facing down)'
m['offhand'] = 'Anatomical right holds reins; no shield'
m['animations'][0]['file'] = 'Idle-v2.png'
m['animations'][0]['description'] = 'Iron-armored horse archer holds an undrawn recurve bow in his left hand (screen-right), with reins in his right hand.'
save('animations.json', m)
g = json.loads((p/'Generation.json').read_text())
g['records'].append({'id':'russian-classicalage-horse-archer-idle-v2-left-hand','file':'Idle-v2.png','clip':'idle','prompt':(p/'Left-Hand-Prompt.txt').read_text().strip(),'references':['Idle-v1.png'],'generatedSource':'C:/Users/Damien/.codex/generated_images/01a11641-9e1b-7c81-be76-c9edd53ef182/exec-b1276f8b-63ce-4cd0-a6c5-631bc7df2d45.png','status':'selected-idle-design-review'})
g['records'][0]['status'] = 'superseded-hand-correction-source-preserved'
save('Generation.json', g)
im = Image.open(p/'Idle-v2.png')
a = im.getchannel('A')
assert im.size == (1254,1254) and im.mode == 'RGBA'
edge = max(a.crop((0,0,1254,1)).getextrema()[1], a.crop((0,1253,1254,1254)).getextrema()[1], a.crop((0,0,1,1254)).getextrema()[1], a.crop((1253,0,1254,1254)).getextrema()[1])
assert edge == 0
save('Validation.json', {'date':'2026-10-07','file':'Idle-v2.png','size':im.size,'mode':im.mode,'visibleBounds':a.getbbox(),'edgeGuardAlphaMax':edge,'nativeSourcePreserved':True,'sha256':hashlib.sha256((p/'Idle-v2.png').read_bytes()).hexdigest(),'userApproval':'Pending corrected idle review','runtimeIntegration':False})
print('Left-hand idle registered; native RGBA and transparent edges verified.')
