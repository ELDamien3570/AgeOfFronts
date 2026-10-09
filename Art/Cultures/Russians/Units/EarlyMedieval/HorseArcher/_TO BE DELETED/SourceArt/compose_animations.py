"""Bake whole ImageGen poses with a shared scale and fixed saddle roots."""
from pathlib import Path
from PIL import Image
import json, hashlib, shutil
ROOT=Path(__file__).resolve().parent.parent
SRC=ROOT/'SourceArt'
def write(p,d): p.write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
for n in ['animations.json','Validation.json','Browser-Review.json']:
    b=SRC/('Before-Animation-'+n)
    if not b.exists(): shutil.copy2(ROOT/n,b)
meta=json.loads((SRC/'Before-Animation-animations.json').read_text())
approved=sha(ROOT/'Idle-v3.png')
write(SRC/'Approved-Idle.json',{'file':'Idle-v3.png','sha256':approved,'approval':'User requested animation on 2026-10-07.'})
ids=['idle','running','attack','hit','charged','charge','charge-attack','death','death-thrown']
labels=['Idle','Walk','Bow shot','Get hit','Get charged','Gallop / maintain charge','Charge shot','Death - together fall','Death - thrown rider']
times=[[320]*6,[180]*6,[160,190,230,100,180,230],[100,100,130,130,170,180],[130,130,180,190,180,240],[100]*6,[160,190,230,100,180,230],[150,180,200,220,260,450],[150,180,210,230,270,450]]
descs=['Nearly still idle: subtle breathing and a small ear or tail-tip twitch; rider and bow stay steady.','Four-beat horse walk with alternating reach and recovery.','Nock, draw with right hand, release from left-held recurve bow, and recover.','Rider recoils and horse braces, then recovers.','Heavy impact staggers horse and rider before recovery.','Collected horse gallop; gameplay supplies world movement.','Advance, brace, draw and release a mounted bow shot, then recover.','Horse and rider buckle and fall together; ending remains settled.','Rider is thrown beside the standing horse and remains fallen.']
clips=[];checks=[];recipes=[];records=[]
plan=json.loads((SRC/'Animation-Plan.json').read_text())
for ident,label,durations,desc in zip(ids,labels,times,descs):
    record_path=max(SRC.glob('Generation-motion-'+ident+'-v*.json'),key=lambda f:int(f.stem.rsplit('-v',1)[1]))
    rec=json.loads(record_path.read_text())
    for draft_path in SRC.glob('Generation-motion-'+ident+'-v*.json'):
        draft=json.loads(draft_path.read_text(encoding='utf-8'))
        draft_copy=SRC/('Native-'+draft['file'])
        if not draft_copy.exists():shutil.copy2(draft['generatedSource'],draft_copy)
    original=json.loads((SRC/('Generation-motion-'+ident+'-v1.json')).read_text())
    original_copy=SRC/('Native-'+original['file'])
    if not original_copy.exists():shutil.copy2(original['generatedSource'],original_copy)
    previous=SRC/('Generation-motion-'+ident+'-v2.json')
    if previous.exists():
        prior=json.loads(previous.read_text());prior_copy=SRC/('Native-'+prior['file'])
        if not prior_copy.exists():shutil.copy2(prior['generatedSource'],prior_copy)
    native=SRC/('Native-'+rec['file'])
    if not native.exists(): shutil.copy2(rec['generatedSource'],native)
    im=Image.open(native)
    assert im.mode=='RGBA' and im.size==(1536,1024),(ident,im.mode,im.size)
    display_scale=rec.get('displayScale',1.25/rec.get('sourcePoseScale',1))
    out=Image.new('RGBA',(1536,1024));frames=[];cells=[];placements=[]
    cuts=plan.get('sourceRowCuts',{}).get(ident,[512]*3)
    for i in range(6):
        x,y=(i%3)*512,(i//3)*512
        top,bottom=(0,cuts[i%3]) if i<3 else (cuts[i%3],1024)
        # Narrow pose corrections retain the earlier whole frames outside the edit.
        frame_source=rec.get('preservedFrameSource') if i in rec.get('preservedFrameIndices',[]) else None
        frame_image=Image.open(ROOT/frame_source) if frame_source else im
        cell=frame_image.crop((x,top,x+512,bottom))
        baked=cell.resize((410,round(cell.height*.8)),Image.Resampling.LANCZOS)
        dest=(x+50,y+50+round((top-y)*.8))
        out.paste(baked,dest)
        frame=out.crop((x,y,x+512,y+512));a=frame.getchannel('A');bounds=a.point(lambda v:255 if v>16 else 0).getbbox()
        assert bounds is not None
        guard=max(a.crop(box).getextrema()[1] for box in [(0,0,512,8),(0,504,512,512),(0,0,8,512),(504,0,512,512)])
        assert guard==0,(ident,i,'guard',guard)
        root=254.8;s=400/512*display_scale
        preview=[256+(v-root)*s for v in bounds]
        assert min(preview)>=0 and max(preview)<=512,(ident,i,preview)
        frames.append({'index':i,'sourceIndex':i,'x':x,'y':y,'width':512,'height':512,'pivot':{'x':root,'y':root}})
        cells.append({'frame':i,'visibleBounds':bounds,'guardAlphaMax':guard,'registeredPreviewBounds':preview,'sha256':hashlib.sha256(frame.tobytes()).hexdigest()})
        placements.append({'sourceRect':[x,top,x+512,bottom],'destinationOffset':[50,50+round((top-y)*.8)],'source':frame_source or str(native.relative_to(ROOT)),'sourceSha256':sha(ROOT/frame_source) if frame_source else sha(native)})
    assert len(set(c['sha256'] for c in cells))==6,(ident,'duplicate poses')
    out.save(ROOT/rec['file'])
    clip={'id':ident,'file':rec['file'],'label':label,'loop':ident in ['idle','running','charge'],'scale':display_scale,'durations':durations,'description':desc,'frameCount':6,'frames':frames,'sourceFrameOrder':list(range(6))}
    if ident in ['attack','charge-attack']:clip['impactFrame']=3
    clips.append(clip);checks.append({'clip':ident,'distinctFrames':6,'size':[1536,1024],'frames':cells})
    recipes.append({'clip':ident,'source':str(native.relative_to(ROOT)),'sourceSha256':sha(native),'output':rec['file'],'outputSha256':sha(ROOT/rec['file']),'uniformScale':.8,'displayScale':display_scale,'authoredSourcePoseScale':rec.get('sourcePoseScale',1),'fixedRoot':[254.8,254.8],'placements':placements})
    records.append({**rec,'status':'selected-animation-source','nativeCopy':str(native.relative_to(ROOT))})
meta.update({'stage':'single-mounted-actor-art-prototype','integrationStatus':'Nine solo horse archer clips for visual review; gameplay integration is separate.','sheetSize':{'width':1536,'height':1024},'grid':{'columns':3,'rows':2},'registration':'One common whole-pose scale and fixed saddle pivot; no silhouette fitting.','deathVariants':['death','death-thrown'],'motionContract':'Local gait, bow shot and reactions; gameplay owns movement, formations, projectile spawning and combat timing.','animations':clips})
write(ROOT/'animations.json',meta)
write(ROOT/'Validation.json',{'date':'2026-10-07','clipCount':9,'frameCount':54,'approvedIdlePreserved':sha(ROOT/'Idle-v3.png')==approved,'runtimeIntegration':False,'userApproval':'Approved idle; animations pending visual review.','clips':checks})
write(SRC/'Composition.json',{'method':'Whole generated pose uniform scaling and transparent padding; native sources and alpha preserved.','authorization':'User authorized composing and baking sprites.','clips':recipes})
g=json.loads((ROOT/'Generation.json').read_text());existing={r.get('generatedSource') for r in g['records']}
for f in SRC.glob('Generation-motion-*-v*.json'):
    draft=json.loads(f.read_text())
    if draft['generatedSource'] not in existing:
        g['records'].append({**draft,'status':'superseded-animation-source-preserved'});existing.add(draft['generatedSource'])
selected={r['generatedSource'] for r in records}
for r in g['records']:
    if r.get('generatedSource') in selected:r['status']='selected-animation-source'
    elif r.get('file','').startswith('Idle-Animated'):r['status']='superseded-animation-source-preserved'

for record in g['records']:
    if record.get('file')=='Idle-v3.png': record['status']='approved-design-reference'
g['userApproval']='Idle-v3 approved; animations pending review.'
write(ROOT/'Generation.json',g)
h=(ROOT/'Actor_Review.html').read_text(encoding='utf-8').replace('One mounted bowman. One idle frame.','One mounted bowman. Nine motions.').replace('href="Idle-v3.png"','href="Idle-Animated-v1.png"').replace('Idle design review','Single mounted actor review').replace('max="0"','max="5"').replace('1 / 1</output>','1 / 6</output>').replace('Loading mounted archer idle','Loading nine horse archer sprite sheets')
(ROOT/'Actor_Review.html').write_text(h,encoding='utf-8')
print('Nine clips / 54 unique frames validated; fixed roots and approved idle preserved.')
