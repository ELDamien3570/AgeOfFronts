"""Publish the separate Late Medieval mounted archer idle for review."""
from pathlib import Path
from PIL import Image
from urllib.request import urlopen
import hashlib, json, shutil

root = Path(__file__).resolve().parent
units = root.parent.parent
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def write(p, v): p.write_text(json.dumps(v, indent=2)+'\n', encoding='utf-8')
records = [read(root/'SourceArt'/name) for name in ['Generation-idle-v1.json', 'Generation-idle-v2.json']]
shutil.copy2(records[0]['generatedSource'], root/'SourceArt/Idle-v1-halo-draft.png')
shutil.copy2(records[1]['generatedSource'], root/'Idle-v2.png')
im = Image.open(root/'Idle-v2.png')
assert im.mode == 'RGBA'
w, h = im.size
a = im.getchannel('A')
assert a.getextrema()[0] == 0 and a.getextrema()[1] >= 240
assert all(a.getpixel(pt) == 0 for pt in [(0,0),(w-1,0),(0,h-1),(w-1,h-1)])
meta = read(units/'EarlyMedieval/Druzhina/SourceArt/Before-Animation-animations.json')
meta.update(age='LateMedieval', unit='Armored Horse Archer', category='Mounted Archer', integrationStatus='First idle design pending visual review before animation.', weapon='Compact wood and horn recurve bow', offhand='Left hand holds bow; right hand holds reins', mount='Dun/bay horse with articulated steel lamellar barding and fitted chamfron', equipmentFinish='Refined steel lamellar, mail, steel helmet and bracers with restrained brass accents over russet cloth', sheetSize={'width':w,'height':h})
c = meta['animations'][0]
c.update(file='Idle-v2.png', scale=w/max(w,h), description='Relaxed armored mounted archer; left-hand recurve bow, right-hand reins, segmented horse barding.', frameCount=1)
c['frames'][0].update(width=w,height=h,pivot={'x':w/2,'y':h/2})
write(root/'animations.json', meta)
html = (units/'EarlyMedieval/HorseArcher/Actor_Review.html').read_text(encoding='utf-8')
for old, new in [('Russian Early Medieval Pontic Horse Archer','Russian Late Medieval Armored Horse Archer'), ('Early Medieval Age','Late Medieval Age'), ('One mounted bowman. Nine motions.','One armored horse archer. One idle frame.'), ('Circa AD 900 steppe rider: iron lamellar vest, recurve bow, riding kaftan, and an unarmored horse.','Refined steel lamellar and mail, recurve bow, and articulated armor on the horse.'), ('Pontic Horse Archer','Armored Horse Archer'), ('max="5"','max="0"'), ('1 / 6','1 / 1'), ('Loading nine horse archer sprite sheets','Loading armored horse archer idle'), ('Idle-Registered-v6.png','Idle-v2.png'), ('../../ClassicalAge/LightCavalry/Actor_Review.html','../../EarlyMedieval/HorseArcher/Actor_Review.html'), ('Classical cavalry reference','Early Medieval base')]:
    html = html.replace(old,new)
(root/'Actor_Review.html').write_text(html,encoding='utf-8')
write(root/'Generation.json', {'date':'2026-10-07','mode':'built-in-imagegen','userApproval':'Idle pending review; no animations generated yet.','records':records,'supersededDraft':'SourceArt/Idle-v1-halo-draft.png retained; surrounding halo removed in v2.'})
manifest = read(units/'Manifest.json')
entry = {'id':'russian-latemedieval-horse-archer','age':'LateMedieval','label':'Russian armored horse archer - single rider','metadata':'LateMedieval/HorseArcher/animations.json','review':'LateMedieval/HorseArcher/Actor_Review.html','actorCount':1}
if not any(e['id']==entry['id'] for e in manifest['units']):
    manifest['units'].append(entry)
    write(units/'Manifest.json',manifest)
write(root/'Validation.json', {'date':'2026-10-07','size':[w,h],'mode':im.mode,'alphaExtrema':a.getextrema(),'visibleBounds':a.getbbox(),'sha256':hashlib.sha256((root/'Idle-v2.png').read_bytes()).hexdigest(),'userApproval':'Idle pending review','runtimeIntegration':False})
checks=[]
for name in ['Actor_Review.html','animations.json','Idle-v2.png']:
    with urlopen('http://127.0.0.1:9018/Cultures/Russians/Units/LateMedieval/HorseArcher/'+name,timeout=10) as response:
        assert response.status==200 and response.read()==(root/name).read_bytes()
        checks.append({'file':name,'status':200})
write(root/'Browser-Review.json', {'httpChecks':checks,'nativeIdleInspected':True,'browserPlaybackVerified':False,'limitation':'Windows browser automation sandbox unavailable.','userApproval':'Pending idle review','runtimeIntegration':False})
print('Late Medieval idle and three local review assets validated.')
