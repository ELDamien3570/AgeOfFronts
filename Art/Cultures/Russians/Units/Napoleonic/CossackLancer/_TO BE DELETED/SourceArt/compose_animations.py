"""Preserve native animation sources and publish registered solo Cossack Rider atlases."""
from pathlib import Path
from PIL import Image
from urllib.request import urlopen
import json, shutil, hashlib
import numpy as np

ROOT=Path(__file__).resolve().parent.parent
SRC=ROOT/'SourceArt'
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def write(p,v): p.write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
for name in ['animations.json','Actor_Review.html','Validation.json','Browser-Review.json']:
    backup=SRC/('Before-Animation-'+name)
    if not backup.exists(): shutil.copy2(ROOT/name,backup)
approved=sha(ROOT/'Idle-v1.png')
write(SRC/'Approved-Idle.json',{'file':'Idle-v1.png','sha256':approved,'approval':'User approved overhead Cossack Rider and requested animation.'})
specs=[('idle','Idle',True,[600]*6),('walk','Walk',True,[180]*6),('charge','Gallop / maintain charge',True,[130]*6),('attack','Lance thrust',False,[170,180,150,110,180,230]),('charge-attack','Charge lance thrust',False,[150,180,150,110,180,230]),('hit','Get hit',False,[100,100,130,140,170,200]),('charged-impact','Get charged',False,[130,130,180,200,200,240]),('death','Death - together fall',False,[150,180,200,230,280,650]),('death-thrown','Death - thrown rider',False,[150,180,220,240,280,650])]
clips=[];checks=[];recipes=[];records=[]
def saddle_anchor(cell):
    rgba=np.asarray(cell,dtype=np.float32)
    rgb=rgba[:,:,:3]
    mask=(rgb.min(axis=2)>100)&((rgb.max(axis=2)-rgb.min(axis=2))<25)&(rgba[:,:,3]>200)
    mask[:140]=False;mask[255:]=False;mask[:,:170]=False;mask[:,360:]=False
    row=int(np.argmax(mask.sum(axis=1)))
    yy,xx=np.where(mask[max(140,row-3):min(255,row+4)])
    if len(xx)<100:
        r,g,b=[rgb[:,:,i] for i in range(3)]
        mask=(r>90)&(r-g>20)&(g-b>12)&(rgba[:,:,3]>200)
        mask[:110]=False;mask[180:]=False;mask[:,:170]=False;mask[:,360:]=False
        yy,xx=np.where(mask)
        row=int(np.mean(yy)) if len(yy) else 0
    assert len(xx)>=12,('horse root anchor not found',row)
    return float(xx.mean()),row
for ident,label,loop,durations in specs:
    rec=read(SRC/('Generation-motion-'+ident+'-v1.json'))
    native=SRC/('Native-'+rec['file'])
    if not native.exists(): shutil.copy2(rec['generatedSource'],native)
    im=Image.open(native)
    assert im.mode=='RGBA' and im.size==(1536,1024),(ident,im.mode,im.size)
    cells=[];source_rects=[]
    alpha=np.asarray(im.getchannel('A'))
    cuts=[]
    for column in range(3):
        occupancy=(alpha[400:631,column*512:(column+1)*512]>32).sum(axis=1)
        candidates=np.where(occupancy==0)[0]+400
        assert len(candidates),(ident,column,'rows overlap')
        cuts.append(int(min(candidates,key=lambda v:abs(int(v)-512))))
    for i in range(6):
        x,y=(i%3)*512,(i//3)*512
        top,bottom=(0,cuts[i%3]) if i<3 else (cuts[i%3],1024)
        rect=[x,top,x+512,bottom];source_rects.append(rect)
        expanded=Image.new('RGBA',(512,640),(0,0,0,0))
        expanded.paste(im.crop(tuple(rect)),(0,64+top-y))
        pose=expanded.resize((333,416),Image.Resampling.LANCZOS)
        cell=Image.new('RGBA',(512,512),(0,0,0,0));cell.paste(pose,(90,48));cells.append(cell)
    out=Image.new('RGBA',(1536,1024),(0,0,0,0));tracks=[];frame_checks=[]
    def features(cell):
        a=np.asarray(cell,dtype=np.float32)/255
        return np.concatenate((a[:,:,:3]*a[:,:,3:4],a[:,:,3:4]),axis=2)
    first_anchor=saddle_anchor(cells[0]) if ident not in ['death','death-thrown'] else None
    for i,cell in enumerate(cells):
        dx=dy=0
        anchor=None
        if ident not in ['death','death-thrown']:
            anchor=saddle_anchor(cell)
            dx=round(256-anchor[0])
            dy=first_anchor[1]-anchor[1] if ident=='idle' else 0
        frame=Image.new('RGBA',(512,512),(0,0,0,0));frame.paste(cell,(dx,dy))
        assert np.asarray(frame.getchannel('A'),dtype=np.uint64).sum()==np.asarray(cell.getchannel('A'),dtype=np.uint64).sum(),(ident,i,'registration clips art')
        a=frame.getchannel('A');bounds=a.point(lambda v:255 if v>16 else 0).getbbox()
        assert bounds and min(bounds)>0 and max(bounds)<512,(ident,i,'empty or edge-clipped pose',bounds)
        preview=[256+(v-256)*400/333 for v in bounds]
        assert min(preview)>=0 and max(preview)<=512
        frame_checks.append({'index':i,'visibleBounds':bounds,'sha256':hashlib.sha256(frame.tobytes()).hexdigest()})
        tracks.append({'frame':i,'translationPx':[dx,dy],'saddleRollAnchorBefore':anchor,'targetX':256 if anchor else None})
        out.paste(frame,((i%3)*512,(i//3)*512))
    assert len({f['sha256'] for f in frame_checks})==6,(ident,'duplicate frames')
    output=ident+'-Registered-v1.png';out.save(ROOT/output)
    clip={'id':{'walk':'running','charged-impact':'charged'}.get(ident,ident),'file':output,'label':label,'loop':loop,'scale':512/333,'durations':durations,'description':rec['prompt'].split('Motion: ')[-1],'frameCount':6,'sourceFrameOrder':list(range(6)),'frames':[{'index':i,'sourceIndex':i,'x':(i%3)*512,'y':(i//3)*512,'width':512,'height':512,'pivot':{'x':256,'y':256}} for i in range(6)]}
    if ident in ['attack','charge-attack']: clip['impactFrame']=3
    clips.append(clip);checks.append({'id':clip['id'],'file':output,'distinctFrames':6,'frames':frame_checks})
    recipes.append({'clip':clip['id'],'nativeSource':str(native.relative_to(ROOT)),'sourceSha256':sha(native),'output':output,'outputSha256':sha(ROOT/output),'uniformScale':333/512,'paddingPx':[90,89.6],'sourceRects':source_rects,'displayScale':512/333,'fixedPivot':[256,256],'tracks':tracks})
    records.append({**rec,'nativeCopy':str(native.relative_to(ROOT))})
meta=read(SRC/'Before-Animation-animations.json')
meta.update(stage='single-mounted-actor-art-prototype',integrationStatus='Nine solo Cossack Rider animation clips pending visual review.',sheetSize={'width':1536,'height':1024},grid={'columns':3,'rows':2},registration='Fixed saddle pivot and constant scale. Gray saddle roll anchors all seven living clips horizontally; quiet idle also aligned vertically.',deathVariants=['death','death-thrown'],motionContract='Local gait, lance strikes and reactions. Gameplay owns world movement, formations and combat timing.',animations=clips)
write(ROOT/'animations.json',meta)
assert sha(ROOT/'Idle-v1.png')==approved
write(SRC/'Composition.json',{'method':'Whole generated poses, transparent padding and translation registration. No art repainting or per-frame scaling.','authorization':'User authorized composing and baking sprites.','clips':recipes})
write(ROOT/'Validation.json',{'date':'2026-10-07','clipCount':9,'frameCount':54,'approvedIdlePreserved':True,'runtimeIntegration':False,'userApproval':'Idle approved; animations pending review.','clips':checks})
generation=read(ROOT/'Generation.json');generation['records']+=records;generation['userApproval']='Idle-v1 approved; nine animations pending review.';write(ROOT/'Generation.json',generation)
html=(SRC/'Before-Animation-Actor_Review.html').read_text(encoding='utf-8').replace('One Cossack Rider. One idle frame.','One Cossack Rider. Nine animations.').replace('max="0"','max="5"').replace('1 / 1</output>','1 / 6</output>').replace('Loading Cossack Rider idle','Loading Cossack Rider animations').replace('href="Idle-v1.png"','href="idle-Registered-v1.png"')
(ROOT/'Actor_Review.html').write_text(html,encoding='utf-8')
served=[]
for name in ['Actor_Review.html','animations.json']+[c['file'] for c in clips]:
    with urlopen('http://127.0.0.1:9018/Cultures/Russians/Units/EarlyMedieval/CossackRider/'+name,timeout=10) as response:
        assert response.status==200 and response.read()==(ROOT/name).read_bytes(),name
        served.append({'file':name,'status':200})
write(ROOT/'Browser-Review.json',{'date':'2026-10-07','httpChecks':served,'nativeAtlasesInspected':True,'browserPlaybackVerified':False,'limitation':'HTTP asset checks do not establish rendered browser playback.','userApproval':'Animations pending visual review','runtimeIntegration':False})
print('Nine Cossack Rider clips, 54 distinct frames, and eleven served review assets verified.')
