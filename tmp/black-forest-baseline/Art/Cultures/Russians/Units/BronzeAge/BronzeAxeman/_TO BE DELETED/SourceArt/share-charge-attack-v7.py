from pathlib import Path
import json,copy,shutil
root=Path('Art/Cultures/Russians/Units/BronzeAge/BronzeAxeman')
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
backup=root/'SourceArt'/'Before-Shared-Attack-v7';backup.mkdir(exist_ok=True)
for name in ['animations.json','Generation.json','Actor_Review.html']:
 if not (backup/name).exists():shutil.copy2(root/name,backup/name)
p=root/'animations.json';d=read(p)
source=next(c for c in d['animations'] if c['id']=='charge-attack')
index=next(i for i,c in enumerate(d['animations']) if c['id']=='attack')
label=d['animations'][index]['label']
d['animations'][index]=copy.deepcopy(source)
d['animations'][index].update(id='attack',label=label,description='Use the same planted, body-driven mace swing as charge attack.')
d['artRevision']='bronze-mace-shared-attack-v7'
d['artRevisions'].append({'date':'2026-10-07','clips':['attack'],'reason':'User selected the charge-attack animation for both attack slots. Sheet, frames, scale, pivots, timing and impact marker shared exactly.','userApproval':'User requested charge attack for both attacks.'})
p.write_text(json.dumps(d,indent=2),encoding='utf-8')
p=root/'Generation.json';g=read(p);g['selectedFiles']['attack']=source['file']
g.setdefault('compositions',[]).append({'id':'shared-mace-attack-v7','type':'clip-reference-reuse','sourceClip':'charge-attack','targetClip':'attack','file':source['file'],'reason':'User requested the charge attack for both attacks; no pixel edits.'})
p.write_text(json.dumps(g,indent=2),encoding='utf-8')
p=root/'Actor_Review.html';s=p.read_text(encoding='utf-8').replace('Heavy strikes v6','Shared attack v7').replace('revision=bronze-mace-heavy-v6','revision=bronze-mace-shared-attack-v7')
p.write_text(s,encoding='utf-8')
print('Both attacks select '+source['file'])

