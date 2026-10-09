import json, hashlib
from pathlib import Path
from PIL import Image
root=Path('Art/Cultures/Russians/Buildings'); out=root/'Review/Stationary-AA-2026-10-07'
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
before=read(out/'Before.json')['images']
changed=[x['file'] for x in before if not Path(x['file']).is_file() or sha(Path(x['file']))!=x['sha256']]
assert not changed,changed
r=read(out/'Generated.json');a=r['asset'];p=root/'Modern'/a['file'];master=root/'Modern'/a['selectedSourceFile']
assert sha(p)==sha(master)==a['sha256']
assert read(p.parent/'Generation.json')==r
assert next(x for x in read(root/'Modern/Generation.json')['assets'] if x['id']==a['id'])==a
m=read(root/'manifest.json');assert len(m['assets'])==98
assert sum(x['age']=='Modern' for x in m['assets'])==21
assert sum(x['age']=='EarlyModern' for x in m['assets'])==18
assert len([x for x in m['assets'] if x['id']=='anti-aircraft'])==2
im=Image.open(p);assert im.mode=='RGBA'
alpha=im.getchannel('A');assert alpha.getextrema()[0]==0 and alpha.getextrema()[1]>=250
b=alpha.point(lambda x:255 if x>=128 else 0).getbbox();assert b and b[0]>0 and b[1]>0 and b[2]<im.width and b[3]<im.height
report=dict(date='2026-10-07',passed=True,existingImagesPreserved=len(before),changedPriorImages=changed,newModernIcons=1,earlyModernIcons=18,modernIcons=21,selectedMaster=a['selectedSourceFile'],alphaRange=alpha.getextrema(),size=im.size,solidAlphaBounds=b,sha256=a['sha256'],preservedMasters=['Icon-v1.png','Icon-v2.png'])
(out/'Source-Validation.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
