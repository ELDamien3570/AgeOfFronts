"""Remove lateral placement drift from whole galloping poses without altering the gait."""
from pathlib import Path
from PIL import Image
import numpy as np
import json, hashlib, shutil

root=Path(__file__).resolve().parent.parent
source=root/'SourceArt'
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def write(p,v): p.write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
sheet=Image.open(root/'Charge-v1.png')
cells=[sheet.crop(((i%3)*512,(i//3)*512,(i%3+1)*512,(i//3+1)*512)) for i in range(6)]
def analyze(im):
    rgba=np.asarray(im,dtype=np.float32)/255
    return np.concatenate((rgba[:,:,:3]*rgba[:,:,3:4],rgba[:,:,3:4]),axis=2)
# Register torso and saddle detail, excluding moving hooves and tail.
roi=(185,180,340,310)
l,t,r,b=roi
target=analyze(cells[0])[t:b,l:r]
atlas=Image.new('RGBA',(1536,1024),(0,0,0,0));tracks=[];checks=[]
for i,cell in enumerate(cells):
    candidate=analyze(cell)
    options=[]
    for dx in range(-70,71):
        for dy in range(-12,13,2):
            difference=candidate[t-dy:b-dy,l-dx:r-dx]-target
            options.append((float(np.mean(difference[::3,::3]**2)),abs(dx)+abs(dy),dx,dy))
    error,_,dx,measured_dy=min(options)
    # Keep authored vertical bob and limb articulation: apply horizontal motion only.
    frame=Image.new('RGBA',(512,512),(0,0,0,0));frame.paste(cell,(dx,0))
    a=frame.getchannel('A')
    assert np.asarray(a,dtype=np.uint64).sum()==np.asarray(cell.getchannel('A'),dtype=np.uint64).sum(),'Pose clipping'
    assert max(a.crop(box).getextrema()[1] for box in [(0,0,512,8),(0,504,512,512),(0,0,8,512),(504,0,512,512)])==0
    bounds=a.point(lambda v:255 if v>16 else 0).getbbox()
    preview=[256+(v-254.8)*(400/512*1.25) for v in bounds]
    assert min(preview)>=0 and max(preview)<=512
    tracks.append({'frame':i,'translationPx':[dx,0],'matchedRegion':list(roi),'measuredVerticalOffsetNotApplied':measured_dy,'alignmentError':error})
    checks.append({'frame':i,'visibleBounds':bounds,'guardAlphaMax':0,'registeredPreviewBounds':preview,'sha256':hashlib.sha256(frame.tobytes()).hexdigest()})
    atlas.paste(frame,((i%3)*512,(i//3)*512));print(i,dx)
assert len({c['sha256'] for c in checks})==6
output='Charge-Registered-v2.png';atlas.save(root/output)
meta=read(root/'animations.json')
protected={c['file']:sha(root/c['file']) for c in meta['animations'] if c['id']!='charge'}
for name in ['animations.json','Validation.json','Browser-Review.json']:
    backup=source/('Before-Registered-Gallop-'+name)
    if not backup.exists(): shutil.copy2(root/name,backup)
clip=next(c for c in meta['animations'] if c['id']=='charge')
clip.update(file=output,description='Horse gallop with lateral placement drift removed; authored vertical bob and leg motion retained.')
write(root/'animations.json',meta)
v=read(root/'Validation.json');check=next(c for c in v['clips'] if c['clip']=='charge')
check.update(file=output,frames=checks)
v['registeredGallopRevision']={'source':'Charge-v1.png','sourceSha256':sha(root/'Charge-v1.png'),'outputSha256':sha(root/output),'tracks':tracks,'unchangedOtherClipHashes':protected}
write(root/'Validation.json',v)
recipe=read(source/'Composition.json');track=next(c for c in recipe['clips'] if c['clip']=='charge')
track.update(output=output,outputSha256=sha(root/output),registrationSource='Charge-v1.png',registrationSourceSha256=sha(root/'Charge-v1.png'),registrationOffsets=tracks)
write(source/'Composition.json',recipe)
generation=read(root/'Generation.json')
if not any(c.get('file')==output for c in generation['records']):
    generation['records'].append({'file':output,'source':'Charge-v1.png','method':'Whole-pose horizontal translation only; no scaling, pixel painting, filtering or vertical adjustment.','tracks':tracks,'status':'selected-gallop-registration'})
write(root/'Generation.json',generation)
assert all(sha(root/name)==digest for name,digest in protected.items())
print('Six gallop poses registered horizontally; vertical gait, timing, and other eight clips preserved.')

