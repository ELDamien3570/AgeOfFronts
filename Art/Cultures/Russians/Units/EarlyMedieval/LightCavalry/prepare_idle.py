from pathlib import Path
from PIL import Image
import json, hashlib

p=Path(__file__).parent
units=p.parent.parent
im=Image.open(p/'Idle-v1.png')
assert im.mode=='RGBA'
w,h=im.size
alpha=im.getchannel('A')
assert alpha.getextrema()==(0,255)
m=json.loads((units/'ClassicalAge/LightCavalry/SourceArt/Before-Animation-animations.json').read_text(encoding='utf-8'))
m.update(age='EarlyMedieval',stage='single-mounted-idle-design-review',integrationStatus='Single idle design pending user review before animation.',weapon='Long wooden lance with iron leaf spearhead',offhand='Small round wooden shield with iron rim and boss; reins',equipmentFinish='Conical iron helmet, mail shoulders, iron lamellar over red-brown riding coat, leather bracers and boots',sheetSize={'width':w,'height':h})
c=m['animations'][0]
c.update(description='Rus-inspired steppe lancer with lamellar armor, conical helmet, lance and small round shield.')
c['frames'][0].update(width=w,height=h,pivot={'x':w/2,'y':h/2})
(p/'animations.json').write_text(json.dumps(m,indent=2)+'\n',encoding='utf-8')
html=(units/'ClassicalAge/LightCavalry/Actor_Review.html').read_text(encoding='utf-8')
html=html.replace('Classical','Early Medieval').replace('One iron rider. Nine motions.','One Rus lancer. One idle frame.').replace('Iron helmet, pauldrons and bracers, leather and fur, iron-tipped spear, and a chestnut horse.','Conical helmet, mail and lamellar, long lance, small round shield, and a chestnut horse.').replace('max="5"','max="0"').replace('1 / 6','1 / 1').replace('Loading nine light cavalry sprite sheets','Loading lancer idle').replace('../../BronzeAge/LightCavalry/Actor_Review.html','../../ClassicalAge/LightCavalry/Actor_Review.html').replace('Bronze cavalry reference','Classical cavalry reference')
(p/'Actor_Review.html').write_text(html,encoding='utf-8')
manifest_path=units/'Manifest.json'
manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
entry={'id':'russian-earlymedieval-light-cavalry','age':'EarlyMedieval','label':'Russian Rus-inspired steppe lancer - single rider','metadata':'EarlyMedieval/LightCavalry/animations.json','review':'EarlyMedieval/LightCavalry/Actor_Review.html','actorCount':1}
assert not any(e['id']==entry['id'] for e in manifest['units'])
manifest['units'].append(entry)
manifest_path.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
validation={'stage':'idle-review','size':[w,h],'mode':im.mode,'alphaExtrema':alpha.getextrema(),'visibleBounds':alpha.getbbox(),'sha256':hashlib.sha256((p/'Idle-v1.png').read_bytes()).hexdigest(),'userApproval':'Pending idle review','runtimeIntegration':False}
(p/'Validation.json').write_text(json.dumps(validation,indent=2)+'\n',encoding='utf-8')
print(json.dumps(validation))
