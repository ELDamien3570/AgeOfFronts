"""Preserve ImageGen native sheets; bake whole poses with fixed scale and roots."""
from pathlib import Path
from PIL import Image
import hashlib, json, shutil

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT/'SourceArt'
SCALE = 0.80
OFFSET = 44
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def write(path,data): path.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
generation=json.loads((SOURCE/'Animation-Generation.json').read_text())
for name in ['animations.json','Validation.json','Browser-Review.json']:
    backup=SOURCE/('Before-Animation-'+name)
    if not backup.exists():shutil.copy2(ROOT/name,backup)
approved_hash=sha(ROOT/'Idle-v1.png')
write(SOURCE/'Approved-Idle.json',{'file':'Idle-v1.png','sha256':approved_hash,'userApproval':'Approved for animation by user on 2026-10-07'})
data=json.loads((SOURCE/'Before-Animation-animations.json').read_text())
labels={'idle':'Idle','running':'Walk','attack':'Bow shot','hit':'Get hit','charged':'Get charged','charge':'Charge in / maintain','charge-attack':'Advance, plant and shoot','death':'Death - side fall','death-back':'Death - back fall'}
descriptions={'idle':'Breathing and weight settle with a loose arrow ready and the bow held low.','running':'Alternating walking steps with the bow carried low.','attack':'Nock, raise, draw, release, follow through, and ready the next arrow.','hit':'Brief torso recoil and defensive bow tilt, then recover.','charged':'Heavy impact, stumble, crouch, and regain balance.','charge':'Faster alternating running strides with the bow carried close.','charge-attack':'Finish advancing, plant the feet, draw and release one shot, then recover.','death':'Knees buckle, body falls onto its side, and settles into a held final pose.','death-back':'Recoil, buckle, fall face up, and settle with head screen-top and boots screen-bottom.'}
durations={'idle':[170]*6,'running':[160]*6,'attack':[140,180,260,100,180,250],'hit':[100,90,130,130,160,180],'charged':[130,120,180,180,180,230],'charge':[90]*6,'charge-attack':[140,200,260,100,180,250],'death':[150,170,190,210,240,400],'death-back':[150,180,190,210,240,400]}
clips,checks,recipe=[],[],[]
for record in generation['records']:
    native=SOURCE/('Native-'+record['file'])
    if not native.exists():shutil.copy2(record['generatedSource'],native)
idle_ready=Image.open(SOURCE/'Native-Idle-Animated-v1.png').convert('RGBA').crop((0,0,512,512))
hit_recoil=Image.open(SOURCE/'Native-Hit-v1.png').convert('RGBA').crop((512,0,1024,512))
for record in generation['records']:
    ident=record['id']
    native=SOURCE/('Native-'+record['file'])
    if not native.exists():shutil.copy2(record['generatedSource'],native)
    im=Image.open(native).convert('RGBA')
    assert im.size==(1536,1024),(ident,im.size)
    out=Image.new('RGBA',(1536,1024),(0,0,0,0))
    frames,tracks,frame_checks=[],[],[]
    for index in range(6):
        col,row=index%3,index//3
        rect=(col*512,row*512,(col+1)*512,(row+1)*512)
        ready_reset=ident in ['attack','charge-attack'] and index==5
        recoil_reset=ident=='charged' and index==1
        source_rect=rect
        if ident=='attack' and index==4:source_rect=(512,512,1048,1024)
        if ident=='death' and index==1:source_rect=(512,0,984,512)
        if ident=='death' and index==2:source_rect=(984,0,1536,512)
        if ident=='charged' and index==0:source_rect=(0,0,560,512)
        if ident=='charged' and index==2:source_rect=(1060,0,1536,512)
        if ident=='charged' and index==3:source_rect=(0,512,544,1024)
        if ident=='charged' and index==4:source_rect=(544,512,1024,1024)
        pose=idle_ready.copy() if ready_reset else hit_recoil.copy() if recoil_reset else im.crop(source_rect)
        local_x=OFFSET if ready_reset or recoil_reset else OFFSET+round((source_rect[0]-col*512)*SCALE)
        local_y=OFFSET
        source_bounds=pose.getchannel('A').point(lambda v:255 if v>16 else 0).getbbox()
        pose=pose.resize((round(pose.width*SCALE),round(pose.height*SCALE)),Image.Resampling.LANCZOS)
        out.paste(pose,(col*512+local_x,row*512+local_y))
        frame={'index':index,'sourceIndex':index,'x':col*512,'y':row*512,'width':512,'height':512,'pivot':{'x':OFFSET+256*SCALE,'y':OFFSET+270*SCALE}}
        frames.append(frame)
        tracks.append({'index':index,'sourceFile':'Native-Idle-Animated-v1.png' if ready_reset else 'Native-Hit-v1.png' if recoil_reset else native.name,'sourceRect':[0,0,512,512] if ready_reset else [512,0,1024,512] if recoil_reset else list(source_rect),'uniformScale':SCALE,'destinationOffset':[local_x,local_y],'sourceRoot':[256,270] if ready_reset else [768,270] if recoil_reset else [col*512+256,row*512+270],'reason':'Reuse matching ready pose for a clean two-handed return after follow-through.' if ready_reset else 'Reuse clean recoil pose instead of the generated three-leg impact pose.' if recoil_reset else 'Authored native motion pose; gutters isolate complete bow silhouettes.'})
        cell=out.crop(rect);a=cell.getchannel('A');bounds=a.point(lambda v:255 if v>16 else 0).getbbox()
        guard=max(a.crop(r).getextrema()[1] for r in [(0,0,512,8),(0,504,512,512),(0,0,8,512),(504,0,512,512)])
        assert guard==0,(ident,index,guard)
        assert bounds is not None
        l,t,r,b=bounds;x,y=frame['pivot']['x'],frame['pivot']['y'];s=400/512
        preview=[256+(l-x)*s,256+(t-y)*s,256+(r-x)*s,256+(b-y)*s]
        assert min(preview)>=0 and max(preview)<=512,(ident,index,preview)
        frame_checks.append({'frame':index,'nativeVisibleBounds':source_bounds,'visibleBounds':bounds,'guardAlphaMax':guard,'registeredPreviewBounds':preview,'sha256':hashlib.sha256(cell.tobytes()).hexdigest()})
    out.save(ROOT/record['file'])
    clip={'id':ident,'file':record['file'],'label':labels[ident],'loop':ident in ['idle','running','charge'],'scale':1,'durations':durations[ident],'description':descriptions[ident],'frameCount':6,'frames':frames,'sourceFrameOrder':list(range(6))}
    if ident in ['attack','charge-attack']:clip['releaseFrame']=3;clip['impactFrame']=3
    clips.append(clip)
    checks.append({'clip':ident,'file':record['file'],'size':[1536,1024],'mode':'RGBA','distinctFrames':len(set(f['sha256'] for f in frame_checks)),'frames':frame_checks})
    recipe.append({'clip':ident,'source':native.name,'sourceSha256':sha(native),'output':record['file'],'outputSha256':sha(ROOT/record['file']),'tracks':tracks})
data.update({'stage':'single-actor-art-prototype','integrationStatus':'Solo animation review; runtime formations and gameplay integration are separate.','sheetSize':{'width':1536,'height':1024},'grid':{'columns':3,'rows':2},'registration':'Whole authored poses baked at one common 0.80 scale with fixed root pivots, never per-frame bounds fitting.','deathVariants':['death','death-back'],'motionContract':'Artwork supplies local gait and bow poses. Gameplay owns world movement, formation placement, projectile creation and combat effects.','animations':clips})
write(ROOT/'animations.json',data)
write(SOURCE/'Composition.json',{'date':'2026-10-07','authorization':'User authorized composing and baking sprites; solo actors only.','method':'Whole-pose crop, uniform scale and transparent padding; no painting or alpha filtering in code.','clips':recipe})
assert sha(ROOT/'Idle-v1.png')==approved_hash
write(ROOT/'Validation.json',{'date':'2026-10-07','actorCount':1,'clipCount':len(clips),'frameCount':sum(c['frameCount'] for c in clips),'approvedIdlePreserved':True,'eightPixelGuard':'Zero alpha on every cell border.','registeredPreview':'All 54 frames fit the fixed 400px footprint within a 512px canvas.','visualApproval':'Idle approved; animations pending user review.','runtimeIntegration':False,'clips':checks})
history=json.loads((ROOT/'Generation.json').read_text());history['userApproval']='Idle design approved for animation; new animations pending review.'
for r in history['records']:
    if r['file']=='Idle-v1.png':r['status']='approved-design-reference'
existing={r.get('generatedSource') for r in history['records']}
history['records'] += [r for r in generation['records'] if r['generatedSource'] not in existing]
write(ROOT/'Generation.json',history)
html=(ROOT/'Actor_Review.html').read_text(encoding='utf-8').replace('One archer. One idle frame.','One archer. Nine motions.').replace('Idle design review','Single actor animation review').replace('max="0"','max="5"').replace('1 / 1</output>','1 / 6</output>').replace('Loading idle design','Loading nine sprite sheets')
(ROOT/'Actor_Review.html').write_text(html,encoding='utf-8')
print(json.dumps({'clips':len(clips),'frames':54,'guardsPassed':True,'approvedIdlePreserved':True,'nativeBounds':{c['clip']:[f['nativeVisibleBounds'] for f in c['frames']] for c in checks}}))
