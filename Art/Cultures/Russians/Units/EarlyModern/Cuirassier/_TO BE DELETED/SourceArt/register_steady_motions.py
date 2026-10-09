"""Register five whole poses horizontally against horse rump and saddle detail."""
from pathlib import Path
from PIL import Image
from urllib.request import urlopen
import numpy as np
import json, shutil, hashlib

root=Path(__file__).resolve().parent.parent
src=root/'SourceArt'
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def write(p,v): p.write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
targets={'running':'walk','attack':'attack','charge-attack':'charge-attack','hit':'hit','charged':'charged-impact'}
meta=read(root/'animations.json')
for name in ['animations.json','Validation.json','Browser-Review.json','Generation.json']:
    backup=src/('Before-Steady-Motions-'+name)
    if not backup.exists(): shutil.copy2(root/name,backup)
protected={c['file']:sha(root/c['file']) for c in meta['animations'] if c['id'] not in targets}
def features(im):
    a=np.asarray(im,dtype=np.float32)/255
    return np.concatenate((a[:,:,:3]*a[:,:,3:4],a[:,:,3:4]),axis=2)
def saddle_anchor(cell):
    a=np.asarray(cell,dtype=np.float32)
    r,g,b,alpha=[a[:,:,c] for c in range(4)]
    mask=(r>140)&(g>120)&(b>90)&(r-g<45)&(r-b>20)&(r-b<90)&(alpha>200)
    mask[:110]=False;mask[185:]=False;mask[:,:190]=False;mask[:,360:]=False
    row=int(np.argmax(mask.sum(axis=1)))
    yy,xx=np.where(mask[max(110,row-3):min(185,row+4)])
    assert len(xx)>=15,('saddle roll not found',row,len(xx))
    return float(xx.mean()),row
results=[]
for clip in meta['animations']:
    if clip['id'] not in targets: continue
    source=targets[clip['id']]+'-Registered-v1.png'
    im=Image.open(root/source)
    assert im.size==(1536,1024) and im.mode=='RGBA'
    cells=[im.crop((i%3*512,i//3*512,(i%3+1)*512,(i//3+1)*512)) for i in range(6)]
    atlas=Image.new('RGBA',im.size,(0,0,0,0));tracks=[];checks=[]
    for i,cell in enumerate(cells):
        anchor,row=saddle_anchor(cell)
        dx=round(256-anchor)
        frame=Image.new('RGBA',(512,512),(0,0,0,0));frame.paste(cell,(dx,0))
        assert np.asarray(frame.getchannel('A'),dtype=np.uint64).sum()==np.asarray(cell.getchannel('A'),dtype=np.uint64).sum(),(clip['id'],i,'translation clips source')
        bounds=frame.getchannel('A').point(lambda v:255 if v>16 else 0).getbbox()
        preview=[256+(v-256)*400/512*clip['scale'] for v in bounds]
        assert min(preview)>=0 and max(preview)<=512,(clip['id'],i,'preview clipping')
        tracks.append({'frame':i,'translationPx':[dx,0],'saddleRollAnchorBefore':[anchor,row],'saddleRollAnchorAfter':[anchor+dx,row],'targetX':256})
        checks.append({'index':i,'visibleBounds':bounds,'sha256':hashlib.sha256(frame.tobytes()).hexdigest()})
        atlas.paste(frame,(i%3*512,i//3*512))
    assert len({c['sha256'] for c in checks})==6
    output=targets[clip['id']]+'-Steady-v2.png';atlas.save(root/output)
    clip.update(file=output,registration='Whole-pose horizontal registration against horse rump and saddle. Vertical gait, sword articulation and rider recoil retained.')
    results.append({'id':clip['id'],'file':output,'source':source,'sourceSha256':sha(root/source),'sha256':sha(root/output),'tracks':tracks,'frames':checks})
    print(clip['id'],[v['translationPx'][0] for v in tracks])
meta['registration']='Fixed pivot and scale. Walk, sword cut, charge thrust, hit and charge impact registered horizontally against horse rump and saddle; authored vertical and limb motion retained.'
write(root/'animations.json',meta)
write(src/'Steady-Motions-v2.json',{'method':'Integer whole-pose horizontal translations only; no repainting, rescaling or vertical correction.','anchor':'Pale saddle roll measured in the upper horse region; fixed target x=256, excludes sword and moving legs.','clips':results,'unchangedOtherClipHashes':protected})
v=read(root/'Validation.json')
for result in results:
    check=next(c for c in v['clips'] if c['id']==result['id'])
    check.update(file=result['file'],frames=result['frames'])
v['steadyMotionRevision']='SourceArt/Steady-Motions-v2.json';write(root/'Validation.json',v)
generation=read(src/'Before-Steady-Motions-Generation.json')
generation['records'].append({'file':'SourceArt/Steady-Motions-v2.json','method':'Horizontal whole-pose registration','userRequest':'Less lateral movement in walk, broadsword cut, charge thrust, get hit and get charged.'})
write(root/'Generation.json',generation)
assert all(sha(root/name)==digest for name,digest in protected.items())
checks=[]
for name in ['Actor_Review.html','animations.json']+[c['file'] for c in meta['animations']]:
    with urlopen('http://127.0.0.1:9018/Cultures/Russians/Units/EarlyModern/Cuirassier/'+name,timeout=10) as response:
        assert response.status==200 and response.read()==(root/name).read_bytes(),name
        checks.append({'file':name,'status':200})
write(root/'Browser-Review.json',{'httpChecks':checks,'nativeAtlasesInspected':True,'browserPlaybackVerified':False,'userApproval':'Steadier five clips pending visual review','runtimeIntegration':False})
print('Five clips registered; timing, vertical motion, approved idle, gallop and death assets preserved.')
