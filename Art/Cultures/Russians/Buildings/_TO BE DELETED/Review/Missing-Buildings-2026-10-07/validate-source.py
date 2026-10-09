import json, hashlib
from pathlib import Path
from PIL import Image
root=Path('Art/Cultures/Russians/Buildings')
out=root/'Review/Missing-Buildings-2026-10-07'
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
before=read(out/'Before.json')['images']
changed=[x['file'] for x in before if not Path(x['file']).is_file() or sha(Path(x['file']))!=x['sha256']]
assert not changed, changed
jobs=read(out/'Generated.json')['assets']; assert len(jobs)==20
manifest=read(root/'manifest.json'); keys=[(x['age'],x['id']) for x in manifest['assets']]
assert len(keys)==len(set(keys))
plan=read(Path('skirmish/plans/technology-plan.json'))
civ=next(x for x in plan['civilizations'] if x['id']=='russians-rework')
tech={x['id']:x for x in civ['technologies']}
checks=[]
for j in jobs:
 p=root/j['file']; s=root/j['selectedSourceFile']
 assert sha(p)==sha(s)==j['sha256'],j['file']
 f=read(p.parent/'Generation.json')['asset']
 a=next(x for x in read(root/j['age']/'Generation.json')['assets'] if x['id']==j['id'])
 assert f==a
 assert root/j['age']/f['selectedSourceFile']==s
 assert f['sha256']==j['sha256']
 entry=next(x for x in manifest['assets'] if x['id']==j['id'] and x['age']==j['age'])
 assert entry['status']=='draft' and entry['file']==j['file']
 assert all(t in tech and tech[t]['age']==j['age'] for t in j['technologyIds']),j['id']
 assert 'wall' not in j['folder'].lower() and 'gate' not in j['folder'].lower()
 im=Image.open(p); assert im.mode=='RGBA' and im.width==im.height
 alpha=im.getchannel('A'); assert alpha.getextrema()[0]==0 and alpha.getextrema()[1]>=250
 b=alpha.point(lambda x:255 if x>=128 else 0).getbbox()
 assert b and b[0]>0 and b[1]>0 and b[2]<im.width and b[3]<im.height
 checks.append(dict(age=j['age'],folder=j['folder'],size=im.size,alphaRange=alpha.getextrema(),solidAlphaBounds=b,selectedMaster=j['selectedSourceFile'],sha256=j['sha256'],technologyIds=j['technologyIds']))
counts={age:sum(x['age']==age for x in manifest['assets']) for age in ['StoneAge','BronzeAge','ClassicalAge','EarlyMedieval','LateMedieval','Napoleonic','EarlyModern','Modern']}
assert sum(counts.values())==97 and counts['EarlyModern']==18 and counts['Modern']==20
report=dict(date='2026-10-07',passed=True,newIcons=20,versionedNewMasters=sum(len(list((root/j['age']/j['folder']/'SourceArt').glob('Icon-v*.png'))) for j in jobs),preservedPriorImages=len(before),changedPriorImages=changed,ageCounts=counts,proposedFacilityConcepts=sum(bool(j.get('proposedBuildingRole',False)) for j in jobs),checks=checks)
(out/'Source-Validation.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='checks'}))
