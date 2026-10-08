"""Publish only the revised catastrophic-collapse clip; preserve other clips and v1 sources."""
from pathlib import Path
from PIL import Image
from urllib.request import urlopen
import json, hashlib, shutil
import numpy as np

ROOT=Path(__file__).resolve().parent.parent
SRC=ROOT/'SourceArt'
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,v): p.write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
record=read(SRC/'Generation-motion-death-v2.json')
native=SRC/'Native-death-v2.png'
shutil.copy2(record['generatedSource'],native)
im=Image.open(native)
assert im.mode=='RGBA' and im.size==(1536,1024)
meta=read(ROOT/'animations.json')
before={c['id']:(c,sha(ROOT/c['file'])) for c in meta['animations'] if c['id']!='death'}
out=Image.new('RGBA',im.size)
checks=[];rects=[]
alpha=np.asarray(im.getchannel('A'))
cuts=[]
for column in range(3):
    empty=np.where((alpha[400:631,column*512:(column+1)*512]>16).sum(axis=1)==0)[0]+400
    assert len(empty),'Adjacent source poses overlap'
    # The blast smoke crosses the nominal row line; retain its full upper-row plume.
    cuts.append(int(min(empty,key=lambda y:abs(int(y)-560))))
for i in range(6):
    x,y=i%3*512,i//3*512
    top,bottom=(0,cuts[i%3]) if i<3 else (cuts[i%3],1024)
    rect=[x,top,x+512,bottom];rects.append(rect)
    expanded=Image.new('RGBA',(512,640))
    expanded.paste(im.crop(tuple(rect)),(0,64+top-y))
    cell=Image.new('RGBA',(512,512))
    cell.paste(expanded.resize((333,416),Image.Resampling.LANCZOS),(90,48))
    # Keep the prior central-hull ignition, rather than the generated muzzle flashes.
    if i==0:
        cell=Image.open(ROOT/'death-Registered-v1.png').crop((0,0,512,512))
    bounds=cell.getchannel('A').point(lambda a:255 if a>16 else 0).getbbox()
    assert bounds and min(bounds)>0 and max(bounds)<512
    assert all(0<=256+(v-256)*400/333<=512 for v in bounds)
    checks.append({'index':i,'visibleBounds':bounds,'sha256':hashlib.sha256(cell.tobytes()).hexdigest()})
    out.paste(cell,(x,y))
assert len({c['sha256'] for c in checks})==6
name='death-Registered-v2.png';out.save(ROOT/name)
for filename in ['animations.json','Validation.json','Browser-Review.json']:
    backup=SRC/('Before-Death-v2-'+filename)
    if not backup.exists(): shutil.copy2(ROOT/filename,backup)
clip=next(c for c in meta['animations'] if c['id']=='death')
clip.update(file=name,sha256=sha(ROOT/name),description='Blast tears the center free of both giant wheels. Detached hull crashes down as the wheels topple flat, exposing their spokes; scattered wreck settles.',durations=[160,200,230,280,400,1100])
write(ROOT/'animations.json',meta)
for c in meta['animations']:
    if c['id']!='death': assert (c,sha(ROOT/c['file']))==before[c['id']]
validation=read(ROOT/'Validation.json')
v=next(c for c in validation['clips'] if c['id']=='death')
v.update(file=name,distinctFrames=6,frames=checks)
validation['deathRevision']='catastrophic-collapse-v2; other three clips byte-preserved'
write(ROOT/'Validation.json',validation)
record.update(nativeCopy=str(native.relative_to(ROOT)),output=name,outputSha256=sha(ROOT/name),supersedes='death-Registered-v1.png',reason='User requested a new catastrophic-collapse death sequence.')
generation=read(ROOT/'Generation.json')
generation['records']=[r for r in generation['records'] if r.get('file')!='death-v2.png']+[record]
write(ROOT/'Generation.json',generation)
write(SRC/'Composition-death-v2.json',{'source':str(native.relative_to(ROOT)),'sourceSha256':sha(native),'output':name,'outputSha256':sha(ROOT/name),'sourceRects':rects,'uniformScale':333/512,'padding':[90,48],'expandedCell':[512,640],'displayScale':512/333,'fixedPivot':[256,256],'otherClipsPreserved':True})
recipe=read(SRC/'Composition-death-v2.json')
recipe['firstFrameOverride']={'source':'death-Registered-v1.png','sha256':sha(ROOT/'death-Registered-v1.png'),'rect':[0,0,512,512],'reason':'Retain central-hull ignition; generated first pose had unwanted muzzle flashes.'}
write(SRC/'Composition-death-v2.json',recipe)
served=[]
for filename in ['Actor_Review.html','animations.json',name]:
    with urlopen('http://127.0.0.1:9018/Cultures/Russians/Units/Modern/TsarTank/'+filename,timeout=10) as response:
        assert response.status==200 and response.read()==(ROOT/filename).read_bytes()
        served.append({'file':filename,'status':200})
review=read(ROOT/'Browser-Review.json')
review.update(deathRevision='catastrophic-collapse-v2',deathRevisionHttpChecks=served,browserPlaybackVerified=False,userApproval='Catastrophic collapse v2 pending visual review')
write(ROOT/'Browser-Review.json',review)
print('Catastrophic collapse v2: six distinct frames, unclipped bounds, served assets verified; other three clips unchanged.')

