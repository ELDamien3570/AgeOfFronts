"""Register existing quiet whole poses by translation; preserve native art and scale."""
from pathlib import Path
from PIL import Image
import numpy as np
import json, hashlib, shutil

root=Path(__file__).resolve().parent.parent
source=root/'SourceArt'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def write(p,v): p.write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')

sheet=Image.open(root/'Idle-Animated-Quiet-v2.png')
cells=[sheet.crop(((i%3)*512,(i//3)*512,(i%3+1)*512,(i//3+1)*512)) for i in range(6)]
def analysis(im):
    rgba=np.asarray(im,dtype=np.float32)/255
    return np.concatenate((rgba[:,:,:3]*rgba[:,:,3:4],rgba[:,:,3:4]),axis=2)
reference=analysis(cells[0])
# Match unchanged saddle/torso/neck detail. Exclude animated tail and ears.
roi=(165,180,365,405)
l,t,r,b=roi
target=reference[t:b,l:r]
offsets=[];frames=[];atlas=Image.new('RGBA',(1536,1024),(0,0,0,0))
for i,cell in enumerate(cells):
    candidate=analysis(cell)
    options=[]
    for dy in range(-40,41,2):
        for dx in range(-40,41,2):
            area=candidate[t-dy:b-dy,l-dx:r-dx]
            error=float(np.mean((area[::3,::3]-target[::3,::3])**2))
            options.append((error,abs(dx)+abs(dy),dx,dy))
    _,_,cx,cy=min(options)
    fine=[]
    for dy in range(cy-2,cy+3):
        for dx in range(cx-2,cx+3):
            error=float(np.mean((candidate[t-dy:b-dy,l-dx:r-dx]-target)**2))
            fine.append((error,abs(dx)+abs(dy),dx,dy))
    error,_,dx,dy=min(fine)
    registered=Image.new('RGBA',(512,512),(0,0,0,0))
    registered.paste(cell,(dx,dy))
    # Translation must not crop any authored visible pixels.
    assert np.asarray(registered.getchannel('A'),dtype=np.uint64).sum()==np.asarray(cell.getchannel('A'),dtype=np.uint64).sum()
    alpha=registered.getchannel('A')
    assert max(alpha.crop(box).getextrema()[1] for box in [(0,0,512,8),(0,504,512,512),(0,0,8,512),(504,0,512,512)])==0
    bounds=alpha.point(lambda v:255 if v>16 else 0).getbbox()
    preview=[256+(v-254.8)*(400/512*1.25) for v in bounds]
    assert min(preview)>=0 and max(preview)<=512
    frames.append({'frame':i,'visibleBounds':bounds,'guardAlphaMax':0,'registeredPreviewBounds':preview,'sha256':hashlib.sha256(registered.tobytes()).hexdigest()})
    offsets.append({'frame':i,'translationPx':[dx,dy],'matchedRegion':list(roi),'alignmentError':error})
    atlas.paste(registered,((i%3)*512,(i//3)*512))
    print(i,dx,dy,round(error,6))
assert len({f['sha256'] for f in frames})==6
output='Idle-Registered-v6.png'
atlas.save(root/output)
metadata=read(root/'animations.json')
protected={c['file']:sha(root/c['file']) for c in metadata['animations'] if c['id']!='idle'}
for name in ['animations.json','Validation.json','Browser-Review.json']:
    backup=source/('Before-Registered-Idle-'+name)
    if not backup.exists(): shutil.copy2(root/name,backup)
clip=next(c for c in metadata['animations'] if c['id']=='idle')
clip.update(file=output,frameCount=6,durations=[600]*6,sourceFrameOrder=list(range(6)),description='Slow, subtle idle with whole poses aligned to the same saddle/torso position.',frames=[{'index':i,'sourceIndex':i,'x':(i%3)*512,'y':(i//3)*512,'width':512,'height':512,'pivot':{'x':254.8,'y':254.8}} for i in range(6)])
metadata['idlePolicy']='Six distinct registered quiet poses. Fixed scale; translation corrects authored placement drift.'
write(root/'animations.json',metadata)
html=(root/'Actor_Review.html').read_text(encoding='utf-8').replace('href="Idle-Hold-v4.png"','href="'+output+'"').replace('href="Idle-Registered-v5.png"','href="'+output+'"')
(root/'Actor_Review.html').write_text(html,encoding='utf-8')
validation=read(root/'Validation.json')
check=next(c for c in validation['clips'] if c['clip']=='idle')
check.update(file=output,distinctFrames=6,size=[1536,1024],frames=frames)
validation['frameCount']=54
validation['registeredIdleRevision']={'source':'Idle-Animated-Quiet-v2.png','sourceSha256':sha(root/'Idle-Animated-Quiet-v2.png'),'outputSha256':sha(root/output),'offsets':offsets,'unchangedNonIdleAssetHashes':protected,'loopDurationMs':3600}
write(root/'Validation.json',validation)
recipe=read(source/'Composition.json')
idle=next(c for c in recipe['clips'] if c['clip']=='idle')
idle.update(output=output,outputSha256=sha(root/output),idlePolicy='Six quiet poses registered by translation only',registrationSource='Idle-Animated-Quiet-v2.png',registrationSourceSha256=sha(root/'Idle-Animated-Quiet-v2.png'),registrationOffsets=offsets)
for key in ['heldSource','heldSourceSha256','heldSourceRect']: idle.pop(key,None)
write(source/'Composition.json',recipe)
generation=read(root/'Generation.json')
if not any(record.get('file')==output for record in generation['records']):
    generation['records'].append({'file':output,'source':'Idle-Animated-Quiet-v2.png','method':'Whole-pose translation using fixed torso registration region; no per-frame scaling, pixel painting or filtering.','offsets':offsets,'status':'selected-registered-animated-idle'})
write(root/'Generation.json',generation)
assert all(sha(root/file)==digest for file,digest in protected.items())
print('Six distinct idle frames restored, with eight other clips unchanged.')
