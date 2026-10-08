"""Bake whole generated poses, preserving masters and editable registration tracks."""
from pathlib import Path
from PIL import Image
from urllib.request import urlopen
import numpy as np
import json, hashlib, shutil

ROOT=Path(__file__).resolve().parent.parent
SRC=ROOT/'SourceArt'
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def write(p,v): p.write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
for name in ['animations.json','Validation.json','Browser-Review.json','Actor_Review.html']:
    backup=SRC/('Before-Animation-'+name)
    if not backup.exists(): shutil.copy2(ROOT/name,backup)
approved=sha(ROOT/'Idle-v2.png')
write(SRC/'Approved-Idle.json',{'file':'Idle-v2.png','sha256':approved,'approval':'User approved design and requested animation on 2026-10-07.'})
specs=[('idle','Idle',True,[600]*6),('walk','Walk',True,[180]*6),('attack','Bow shot',False,[160,190,230,100,180,230]),('hit','Get hit',False,[100,100,130,130,170,180]),('charged-impact','Get charged',False,[130,130,180,190,180,240]),('charge','Gallop / maintain charge',True,[130]*6),('charge-attack','Charge shot',False,[160,190,230,100,180,230]),('death','Death - together fall',False,[150,180,200,220,260,600]),('death-thrown','Death - thrown rider',False,[150,180,210,230,270,600])]
clips=[];checks=[];recipes=[];records=[]
descriptions={'idle':'Quiet six-frame breathing idle, registered to the saddle and torso.','walk':'Natural walking gait with lateral placement drift removed and vertical bob retained.','attack':'Raise the left-held recurve bow, draw with the right hand, shoot forward, and recover.','hit':'Small rider recoil and horse startle, followed by recovery.','charged-impact':'Strong impact recoils the rider and buckles the horse before recovery.','charge':'Galloping loop with articulated horse legs; gameplay supplies world movement.','charge-attack':'Settle after advancing, draw and release a forward mounted shot, then recover.','death':'Horse and rider buckle and fall together; the final corpse stays settled.','death-thrown':'Rider leaves the saddle and falls beside the collapsing horse; both remain settled.'}
def analyze(im):
    rgba=np.asarray(im,dtype=np.float32)/255
    return np.concatenate((rgba[:,:,:3]*rgba[:,:,3:4],rgba[:,:,3:4]),axis=2)
for ident,label,loop,durations in specs:
    record_paths=sorted(SRC.glob('Generation-motion-'+ident+'-v*.json'),key=lambda p:int(p.stem.rsplit('-v',1)[1]))
    rec=read(record_paths[-1])
    for record_path in record_paths:
        draft=read(record_path)
        preserved=SRC/('Native-'+draft['file'])
        if not preserved.exists(): shutil.copy2(draft['generatedSource'],preserved)
    native=SRC/('Native-'+rec['file'])
    if not native.exists(): shutil.copy2(rec['generatedSource'],native)
    im=Image.open(native)
    assert im.mode=='RGBA' and im.size==(1536,1024),(ident,im.mode,im.size)
    display_scale=1.25/rec.get('sourcePoseScale',1)
    cells=[];source_rects=[]
    alpha=np.asarray(im.getchannel('A'))
    # Find the transparent gap between rows; keep poses that cross nominal y512 intact.
    cuts=[]
    for column in range(3):
        occupancy=(alpha[480:561,column*512:(column+1)*512]>32).sum(axis=1)
        minimum=occupancy.min()
        candidates=np.where(occupancy==minimum)[0]+480
        cut=int(min(candidates,key=lambda v:abs(int(v)-512)))
        cuts.append(cut if minimum==0 else None)
    for i in range(6):
        x,y=(i%3)*512,(i//3)*512
        rects=[]
        if cuts[i%3] is not None:
            top,bottom=(0,cuts[i%3]) if i<3 else (cuts[i%3],1024)
            pose=im.crop((x,top,x+512,bottom)).resize((410,round((bottom-top)*.8)),Image.Resampling.LANCZOS)
            cell=Image.new('RGBA',(512,512),(0,0,0,0));cell.paste(pose,(50,50+round((top-y)*.8)))
            rects.append([x,top,x+512,bottom])
        else:
            # Offset tails and noses may occupy the same rows but different columns.
            # Compose exact source strips across transparent gaps, without painting/masking.
            expanded=Image.new('RGBA',(512,600),(0,0,0,0))
            for sx in range(x,x+512,8):
                occupancy=(alpha[480:561,sx:sx+8]>32).sum(axis=1)
                candidates=np.where(occupancy==0)[0]+480
                assert len(candidates),(ident,i,sx,'source poses overlap')
                cut=int(min(candidates,key=lambda v:abs(int(v)-512)))
                top,bottom=(0,cut) if i<3 else (cut,1024)
                rect=[sx,top,sx+8,bottom]
                expanded.paste(im.crop(tuple(rect)),(sx-x,44+top-y))
                rects.append(rect)
            pose=expanded.resize((410,480),Image.Resampling.LANCZOS)
            cell=Image.new('RGBA',(512,512),(0,0,0,0));cell.paste(pose,(50,15))
        cells.append(cell)
        source_rects.append(rects)
    roi=(185,180,340,310)
    l,t,r,b=roi;target=analyze(cells[0])[t:b,l:r]
    tracks=[];frameChecks=[];out=Image.new('RGBA',(1536,1024),(0,0,0,0))
    for i,cell in enumerate(cells):
        dx=dy=0;error=None
        if ident in ['idle','walk'] and i:
            candidate=analyze(cell);options=[]
            for sy in range(-35,36,2) if ident=='idle' else range(-12,13,2):
                for sx in range(-65,66):
                    area=candidate[t-sy:b-sy,l-sx:r-sx]
                    options.append((float(np.mean((area[::3,::3]-target[::3,::3])**2)),abs(sx)+abs(sy),sx,sy))
            error,_,dx,measured_dy=min(options)
            dy=measured_dy if ident=='idle' else 0
        frame=Image.new('RGBA',(512,512),(0,0,0,0));frame.paste(cell,(dx,dy))
        a=frame.getchannel('A')
        assert np.asarray(a,dtype=np.uint64).sum()==np.asarray(cell.getchannel('A'),dtype=np.uint64).sum(),(ident,i,'translation clips pose')
        bounds=a.point(lambda v:255 if v>16 else 0).getbbox()
        assert bounds is not None,(ident,i,'empty frame')
        preview=[256+(v-254.8)*(400/512*display_scale) for v in bounds]
        assert min(preview)>=0 and max(preview)<=512,(ident,i,'preview clipping',preview)
        frameChecks.append({'frame':i,'visibleBounds':bounds,'previewBounds':preview,'sha256':hashlib.sha256(frame.tobytes()).hexdigest()})
        tracks.append({'frame':i,'translationPx':[dx,dy],'matchedRegion':list(roi) if ident in ['idle','walk'] else None,'alignmentError':error})
        out.paste(frame,((i%3)*512,(i//3)*512))
    assert len({f['sha256'] for f in frameChecks})==6,(ident,'duplicate frames')
    output=rec['file'].replace('-v1.png','-Registered-v1.png') if ident in ['idle','walk'] else rec['file']
    out.save(ROOT/output)
    clip={'id':{'walk':'running','charged-impact':'charged'}.get(ident,ident),'file':output,'label':label,'loop':loop,'scale':display_scale,'durations':durations,'description':descriptions[ident],'frameCount':6,'sourceFrameOrder':list(range(6)),'frames':[{'index':i,'sourceIndex':i,'x':(i%3)*512,'y':(i//3)*512,'width':512,'height':512,'pivot':{'x':254.8,'y':254.8}} for i in range(6)]}
    if ident in ['attack','charge-attack']: clip['impactFrame']=3
    clips.append(clip);checks.append({'clip':clip['id'],'file':output,'distinctFrames':6,'frames':frameChecks})
    recipes.append({'clip':clip['id'],'nativeSource':str(native.relative_to(ROOT)),'sourceSha256':sha(native),'output':output,'outputSha256':sha(ROOT/output),'uniformScale':.8,'displayScale':display_scale,'authoredSourcePoseScale':rec.get('sourcePoseScale',1),'placement':[50,50],'fixedPivot':[254.8,254.8],'tracks':tracks})
    for record_path in record_paths:
        draft=read(record_path)
        records.append({**draft,'nativeCopy':'SourceArt/Native-'+draft['file'],'status':'selected-animation-source' if record_path==record_paths[-1] else 'superseded-animation-source-preserved'})
    recipes[-1]['sourceRects']=source_rects
meta=read(SRC/'Before-Animation-animations.json')
meta.update(stage='single-mounted-actor-art-prototype',integrationStatus='Nine solo armored horse archer clips for visual review; gameplay integration is separate.',sheetSize={'width':1536,'height':1024},grid={'columns':3,'rows':2},registration='Common whole-pose scale and fixed saddle pivot. Idle torso aligned in both axes; walk aligned horizontally with gait bob retained.',deathVariants=['death','death-thrown'],motionContract='Local gait, shots and reactions. Gameplay owns world movement, formations, projectile spawning and combat timing.',animations=clips)
write(ROOT/'animations.json',meta)
assert sha(ROOT/'Idle-v2.png')==approved
write(ROOT/'Validation.json',{'date':'2026-10-07','clipCount':9,'frameCount':54,'approvedIdlePreserved':True,'runtimeIntegration':False,'userApproval':'Approved idle; animations pending review.','clips':checks})
write(SRC/'Composition.json',{'method':'Whole-pose uniform resize, transparent padding and registration by translation; no art repainting.','authorization':'User authorized composing and baking sprites.','clips':recipes})
generation=read(ROOT/'Generation.json')
by_source={r.get('generatedSource'):r for r in generation['records']}
for record in records: by_source[record['generatedSource']]=record
generation['records']=list(by_source.values())
generation['userApproval']='Idle-v2 approved; nine animations pending review.'
write(ROOT/'Generation.json',generation)
html=(ROOT/'Actor_Review.html').read_text(encoding='utf-8').replace('One armored horse archer. One idle frame.','One armored horse archer. Nine motions.').replace('max="0"','max="5"').replace('1 / 1</output>','1 / 6</output>').replace('Loading armored horse archer idle','Loading nine armored horse archer sprite sheets').replace('href="Idle-v2.png"','href="Idle-Registered-v1.png"')
(ROOT/'Actor_Review.html').write_text(html,encoding='utf-8')
served=[]
for name in ['Actor_Review.html','animations.json']+[c['file'] for c in clips]:
    with urlopen('http://127.0.0.1:9018/Cultures/Russians/Units/LateMedieval/HorseArcher/'+name,timeout=10) as response:
        assert response.status==200 and response.read()==(ROOT/name).read_bytes(),name
        served.append({'file':name,'status':200})
write(ROOT/'Browser-Review.json',{'httpChecks':served,'nativeAtlasesInspected':True,'browserPlaybackVerified':False,'limitation':'Windows browser automation sandbox unavailable; HTTP verification does not prove playback.','userApproval':'Animations pending review','runtimeIntegration':False})
print('Nine clips, 54 distinct frames and eleven served assets verified.')
