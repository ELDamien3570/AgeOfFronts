from pathlib import Path
from PIL import Image
import json,hashlib

p=Path(__file__).parent
units=p.parent.parent
im=Image.open(p/'Idle-v1.png')
assert im.mode=='RGBA'
w,h=im.size
a=im.getchannel('A')
assert a.getextrema()[0]==0 and a.getextrema()[1]>=240
assert all(a.getpixel(pt)==0 for pt in [(0,0),(w-1,0),(0,h-1),(w-1,h-1)])
m=json.loads((units/'ClassicalAge/LightCavalry/SourceArt/Before-Animation-animations.json').read_text(encoding='utf-8'))
m.update(age='EarlyMedieval',unit='Druzhina',category='Heavy Cavalry',stage='single-mounted-idle-design-review',integrationStatus='Single Druzhina idle design pending review before animation.',weapon='Long wooden lance with iron leaf spearhead',offhand='Reins; lance-only first draft following supplied reference',mount='Dark chestnut horse with iron and brass-accented lamellar barding and chamfron',equipmentFinish='Reinforced conical iron helmet, brass browband, heavy lamellar and mail, iron forearm guards, russet coat',sheetSize={'width':w,'height':h})
c=m['animations'][0]
c['scale']=w/max(w,h)
c.update(description='Druzhina elite heavy lancer on an armored horse; first idle design.')
c['frames'][0].update(width=w,height=h,pivot={'x':w/2,'y':h/2})
(p/'animations.json').write_text(json.dumps(m,indent=2)+'\n',encoding='utf-8')
html=(units/'EarlyMedieval/LightCavalry/Actor_Review.html').read_text(encoding='utf-8')
html=html.replace('Russian Early Medieval Light Cavalry','Russian Early Medieval Druzhina').replace('One Rus lancer. Nine motions.','One Druzhina. One idle frame.').replace('Conical helmet, mail and lamellar, long lance, small round shield, and a chestnut horse.','Heavy lamellar and mail, long lance, and an armored horse with iron and brass fittings.').replace('max="5"','max="0"').replace('1 / 6','1 / 1').replace('Loading nine light cavalry sprite sheets','Loading Druzhina idle').replace('Enlarged single iron light cavalry sprite','Enlarged single Druzhina heavy cavalry sprite')
(p/'Actor_Review.html').write_text(html,encoding='utf-8')
mp=units/'Manifest.json'
manifest=json.loads(mp.read_text(encoding='utf-8'))
entry={'id':'russian-earlymedieval-druzhina','age':'EarlyMedieval','label':'Russian Druzhina - single heavy rider','metadata':'EarlyMedieval/Druzhina/animations.json','review':'EarlyMedieval/Druzhina/Actor_Review.html','actorCount':1}
assert not any(e['id']==entry['id'] for e in manifest['units'])
manifest['units'].append(entry)
mp.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
v={'size':[w,h],'mode':im.mode,'alphaExtrema':a.getextrema(),'visibleBounds':a.getbbox(),'sha256':hashlib.sha256((p/'Idle-v1.png').read_bytes()).hexdigest(),'userApproval':'Pending idle review','runtimeIntegration':False}
(p/'Validation.json').write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
print(json.dumps(v))
