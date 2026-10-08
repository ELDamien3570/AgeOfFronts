"""Register revised charge anticipation and a fixed-camera backward corpse."""
from pathlib import Path
import sys, importlib.util, json, hashlib, statistics, shutil
from PIL import Image
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('registration',ROOT/'register-overhead-v2.py'); helper=importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)
records=json.loads((ROOT/'SourceArt/Windup-Corpse-v5-Generation.json').read_text(encoding='utf-8-sig'))
backup=ROOT/'SourceArt/Before-Windup-Corpse-v5'; backup.mkdir(exist_ok=True)
for file in ('animations.json','Generation.json','Validation.json','Formation/formation.json','Formation/animations.json','Formation/Validation.json'):
    target=backup/file; target.parent.mkdir(exist_ok=True,parents=True)
    if not target.exists(): shutil.copy2(ROOT/file,target)
p=ROOT/'animations.json'; data=json.loads(p.read_text()); checks=[]
for record in records:
    clip=next(c for c in data['animations'] if c['id']==record['id']); image=Image.open(ROOT/record['file']); assert image.size==(1536,1024) and image.mode=='RGBA'
    clip['file']=record['file']; widths=[]; anchors=[]
    for frame in clip['frames']:
        crop=image.crop((frame['x'],frame['y'],frame['x']+512,frame['y']+512))
        if clip['id']=='death-back':
            frame['pivot']={'x':256,'y':256}
            if frame['index']==0: widths.append(helper.crown_center(crop)[2])
        else:
            x,y,width=helper.crown_center(crop); frame['pivot']={'x':x,'y':y+20}; widths.append(width)
        anchors.append({'index':frame['index'],'pivot':frame['pivot'],'visibleBounds':crop.getchannel('A').point(lambda v:255 if v>16 else 0).getbbox()})
    clip['scale']=round(110/statistics.median(widths),5); clip['sha256']=hashlib.sha256((ROOT/record['file']).read_bytes()).hexdigest()
    clip['description']='Deep shoulder and hip coil, loaded anticipation, planted strike and compact recovery.' if clip['id']=='charge-attack' else 'Fixed overhead camera and constant clip scale; backward fall settles into a supine corpse.'
    if clip['id']=='death-back':
        final=clip['frames'][-1]; corpse=image.crop((final['x'],final['y'],final['x']+512,final['y']+512)); corpse.save(ROOT/'Corpse-Back-v5.png'); clip['corpseFile']='Corpse-Back-v5.png'; clip['corpseFrame']=5
    checks.append({'id':clip['id'],'scale':clip['scale'],'anchors':anchors,'perFrameScaleChanges':False})
data['artRevision']='overhead-v5-windup-corpse'; p.write_text(json.dumps(data,indent=2)+'\n')
(ROOT/'SourceArt/Windup-Corpse-v5-Registration.json').write_text(json.dumps(checks,indent=2)+'\n')
p=ROOT/'Generation.json'; generation=json.loads(p.read_text()); generation['records']=[r for r in generation['records'] if r['id'] not in ('charge-attack-windup-corpse-v5','death-back-windup-corpse-v5')]; generation['records'].extend({**r,'id':r['id']+'-windup-corpse-v5'} for r in records); p.write_text(json.dumps(generation,indent=2)+'\n')
p=ROOT/'Formation/formation.json'; definition=json.loads(p.read_text())
for clip in definition['animations']:
    if clip['id'] in ('charge-attack','charge-out','death'):
        stem=clip['file'].split('-ArmFix-v4')[0].split('-Overhead-v2')[0].split('-Windup-Corpse-v5')[0]; clip['file']=stem+'-Windup-Corpse-v5.png'
p.write_text(json.dumps(definition,indent=2)+'\n'); print(json.dumps({'clips':checks,'corpse':'Corpse-Back-v5.png'}))
