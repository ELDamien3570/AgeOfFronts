"""Compose authored single-pose frames at one canvas scale; preserve other clips."""
from pathlib import Path
from PIL import Image
import json,hashlib,shutil
ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'SourceArt'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,d):p.write_text(json.dumps(d,indent=2)+'\n')
gen=json.loads((SOURCE/'Shooting-Mechanics-Generation.json').read_text())
data=json.loads((ROOT/'animations.json').read_text())
val=json.loads((ROOT/'Validation.json').read_text())
for name in ['animations.json','Validation.json','Browser-Review.json']:
    dest=SOURCE/('Before-Shooting-Mechanics-'+name)
    if not dest.exists():shutil.copy2(ROOT/name,dest)
preserved={c['file']:sha(ROOT/c['file']) for c in data['animations'] if c['id'] not in ['attack','charge-attack']}
preserved['Idle-v1.png']=sha(ROOT/'Idle-v1.png')
out=Image.new('RGBA',(1536,1024),(0,0,0,0)); checks=[];tracks=[]
for record in gen['records']:
    native=SOURCE/record['nativeFile']
    if not native.exists():shutil.copy2(record['generatedSource'],native)
    if record['status']!='selected-source':continue
    im=Image.open(native).convert('RGBA')
    assert im.size==(1254,1254),im.size
    i=record['index']; col,row=i%3,i//3
    pose=im.resize((410,410),Image.Resampling.LANCZOS)
    out.paste(pose,(col*512+44,row*512+44))
    a=pose.getchannel('A');b=a.point(lambda v:255 if v>16 else 0).getbbox()
    assert b
    checks.append({'frame':i,'visibleBounds':[v+44 for v in b],'nativeSha256':sha(native),'cellSha256':hashlib.sha256(pose.tobytes()).hexdigest()})
    tracks.append({'index':i,'nativeFile':record['nativeFile'],'nativeSize':[1254,1254],'destinationSize':[410,410],'offset':[44,44],'pivot':{'x':248.8,'y':260.0}})
assert len(checks)==6 and len({c['cellSha256'] for c in checks})==6
filename='Shooting-Mechanics-v10.png';out.save(ROOT/filename)
for ident in ['attack','charge-attack']:
    c=next(c for c in data['animations'] if c['id']==ident);c['file']=filename
    c['description']='Plant, turn into the draw, release with the bow held securely, follow through, and recover. Full-size canted bow and fixed-length straight nocked arrow; vertical overhead camera.'
    e=next(c for c in val['clips'] if c['clip']==ident);e.update({'file':filename,'frames':checks,'distinctFrames':6})
assert all(sha(ROOT/f)==h for f,h in preserved.items())
write(ROOT/'animations.json',data)
val['shootingMechanicsRebuild']={'updatedClips':['attack','charge-attack'],'preservedOtherClipsAndIdle':True,'timingsAndPivots':'Preserved','userApproval':'Pending review','method':'Individual authored poses; both planted shooting actions share the coherent shot cycle.'}
write(ROOT/'Validation.json',val)
write(SOURCE/'Shooting-Mechanics-Bake.json',{'date':'2026-10-07','method':'Whole canvases at common scale; no equipment painting or alpha filtering.','tracks':tracks,'output':filename,'outputSha256':sha(ROOT/filename),'preservedHashes':preserved})
hist=json.loads((ROOT/'Generation.json').read_text());existing={r.get('generatedSource') for r in hist['records']}
hist['records'] += [r for r in gen['records'] if r['generatedSource'] not in existing]
hist['shootingMechanicsRebuild']='Individual pose authoring with full-size bow, rigid nocked arrow, secure grip, and true overhead camera. SourceArt/Shooting-Mechanics-Generation.json and Shooting-Mechanics-Bake.json.'
write(ROOT/'Generation.json',hist)
print('Six individual shooting poses composed. Other seven clips, approved idle, timings and pivots preserved.')
