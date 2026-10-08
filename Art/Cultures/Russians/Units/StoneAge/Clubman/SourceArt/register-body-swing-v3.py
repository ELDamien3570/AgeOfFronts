"""Register the body-powered clubman attacks without changing other clips."""
from pathlib import Path
import sys, importlib.util, json, hashlib, statistics, shutil
from PIL import Image
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('registration',ROOT/'register-overhead-v2.py'); registration=importlib.util.module_from_spec(spec); spec.loader.exec_module(registration)
records=json.loads((ROOT/'SourceArt/BodySwing-v3-Generation.json').read_text(encoding='utf-8-sig'))
backup=ROOT/'SourceArt/Before-BodySwing-v3'; backup.mkdir(exist_ok=True)
for file in ('animations.json','Generation.json','Validation.json','Formation/formation.json','Formation/animations.json','Formation/Validation.json'):
    target=backup/file; target.parent.mkdir(exist_ok=True,parents=True)
    if not target.exists(): shutil.copy2(ROOT/file,target)
p=ROOT/'animations.json'; data=json.loads(p.read_text(encoding='utf-8')); anchors=[]
for record in records:
    clip=next(c for c in data['animations'] if c['id']==record['id']); image=Image.open(ROOT/record['file']); assert image.size==(1536,1024) and image.mode=='RGBA'
    clip['file']=record['file']; widths=[]; points=[]
    for frame in clip['frames']:
        crop=image.crop((frame['x'],frame['y'],frame['x']+512,frame['y']+512)); x,y,width=registration.crown_center(crop)
        frame['pivot']={'x':x,'y':y+20}; widths.append(width); points.append({'index':frame['index'],'crownCenter':[x,y],'crownWidth':width})
    clip['scale']=round(110/statistics.median(widths),5); clip['sha256']=hashlib.sha256((ROOT/record['file']).read_bytes()).hexdigest()
    clip['description']='Planted footwork, hip and shoulder coil, body-powered strike, follow-through and recovery.'
    anchors.append({'id':clip['id'],'scale':clip['scale'],'frames':points})
data['artRevision']='overhead-v2-body-swing-v3'; p.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
(ROOT/'SourceArt/BodySwing-v3-Registration.json').write_text(json.dumps(anchors,indent=2)+'\n',encoding='utf-8')
p=ROOT/'Generation.json'; generation=json.loads(p.read_text(encoding='utf-8')); generation['records']=[r for r in generation['records'] if r['id'] not in ('attack-body-swing-v3','charge-attack-body-swing-v3')]
generation['records'].extend({**r,'id':r['id']+'-body-swing-v3','references':['Attack-Overhead-v2.png' if r['id']=='attack' else 'ChargeAttack-Overhead-v2.png','SourceArt/Overhead-Master-v2.png']} for r in records); p.write_text(json.dumps(generation,indent=2)+'\n',encoding='utf-8')
p=ROOT/'Formation/formation.json'; definition=json.loads(p.read_text())
for clip in definition['animations']:
    if clip['id'] in ('attack','charge-attack','charge-out'):
        clip['file']=clip['file'].replace('-Overhead-v2','-BodySwing-v3')
p.write_text(json.dumps(definition,indent=2)+'\n')
print(json.dumps({'revisedClips':anchors}))
