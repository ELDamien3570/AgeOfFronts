"""Compose generated whole Early Medieval Rus Light Cavalry poses, preserving native art and fixed roots."""
from pathlib import Path
from PIL import Image
import hashlib, json, shutil

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'SourceArt'
SCALE, OFFSET, DISPLAY_SCALE = 0.80, 50, 1.25

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def write(path, data): path.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')

plan = json.loads((SOURCE/'Animation-Plan.json').read_text(encoding='utf-8'))
for name in ['animations.json','Validation.json','Browser-Review.json']:
    backup = SOURCE/('Before-Animation-'+name)
    if not backup.exists() and (ROOT/name).exists(): shutil.copy2(ROOT/name,backup)
metadata = json.loads((SOURCE/'Before-Animation-animations.json').read_text(encoding='utf-8'))
approved_hash = sha(ROOT/'Idle-v1.png')
write(SOURCE/'Approved-Idle.json',{'file':'Idle-v1.png','sha256':approved_hash,'userApproval':'User requested animation of this design on 2026-10-07.'})
labels = {'idle':'Idle','running':'Walk','attack':'Spear thrust','hit':'Get hit','charged':'Get charged','charge':'Gallop / maintain charge','charge-attack':'Charge attack','death':'Death - together fall','death-thrown':'Death - thrown rider'}
timings = {'idle':[170]*6,'running':[180]*6,'attack':[130,180,160,100,180,240],'hit':[100,100,130,130,170,180],'charged':[130,130,180,190,180,240],'charge':[100]*6,'charge-attack':[130,190,160,100,180,240],'death':[150,180,200,220,260,450],'death-thrown':[150,180,210,230,270,450]}
descriptions = {'idle':'Horse breathes and settles while the lancer holds lance and shield.','running':'Four-beat walking steps with clear foreleg and hindleg reach.','attack':'Draw the spear to shoulder level, thrust overarm alongside the horse, and recover.','hit':'Brief rider recoil and horse brace, then recovery.','charged':'Heavy impact staggers horse and rider; both regain their balance.','charge':'Collected gallop with foreleg reach, support, hindleg recovery, and suspension. Gameplay supplies world movement.','charge-attack':'Braced advance into a heavy overarm spear thrust, then recovery.','death':'Horse and rider buckle, fall together onto their side, and settle.','death-thrown':'Rider is thrown clear of the saddle and lands beside the standing horse.'}
clips, checks, recipe, records = [], [], [], []
for job in plan['jobs']:
    ident=job['id'];record_path=SOURCE/('Generation-'+ident+'-v2.json')
    if not record_path.exists(): record_path=SOURCE/('Generation-'+ident+'-v1.json')
    record=json.loads(record_path.read_text(encoding='utf-8'));output_file=record['file']
    original=json.loads((SOURCE/('Generation-'+ident+'-v1.json')).read_text(encoding='utf-8'))
    original_copy=SOURCE/('Native-'+original['file'])
    if not original_copy.exists():shutil.copy2(original['generatedSource'],original_copy)
    native=SOURCE/('Native-'+output_file)
    if not native.exists():shutil.copy2(record['generatedSource'],native)
    im=Image.open(native);assert im.mode=='RGBA' and im.size==(1536,1024),(ident,im.size)
    out=Image.new('RGBA',(1536,1024),(0,0,0,0));frames=[];cells=[];placements=[]
    cuts=plan.get('sourceRowCuts',{}).get(ident,[512,512,512])
    order=record.get('sourceFrameOrder',list(range(6)))
    for index,source_index in enumerate(order):
        x,y=(index%3)*512,(index//3)*512
        sx,sy=(source_index%3)*512,(source_index//3)*512
        top,bottom=(0,cuts[source_index%3]) if source_index<3 else (cuts[source_index%3],1024)
        cell=im.crop((sx,top,sx+512,bottom))
        destination=[OFFSET,OFFSET+round((top-sy)*SCALE)]
        placements.append({'frame':index,'sourceRect':[sx,top,sx+512,bottom],'destinationOffset':destination})
        source_bounds=cell.getchannel('A').point(lambda v:255 if v>16 else 0).getbbox()
        assert source_bounds is not None
        # One common scale for the whole canvas, independent of silhouette bounds.
        baked=cell.resize((round(cell.width*SCALE),round(cell.height*SCALE)),Image.Resampling.LANCZOS)
        out.paste(baked,(x+destination[0],y+destination[1]))
        alpha=baked.getchannel('A')
        frame=out.crop((x,y,x+512,y+512));a=frame.getchannel('A')
        bounds=a.point(lambda v:255 if v>16 else 0).getbbox()
        guard=max(a.crop(r).getextrema()[1] for r in [(0,0,512,8),(0,504,512,512),(0,0,8,512),(504,0,512,512)])
        assert guard==0,(ident,index,guard)
        root=OFFSET+256*SCALE;l,t,r,b=bounds;s=400/512*DISPLAY_SCALE
        preview=[256+(l-root)*s,256+(t-root)*s,256+(r-root)*s,256+(b-root)*s]
        assert min(preview)>=0 and max(preview)<=512,(ident,index,preview)
        frames.append({'index':index,'sourceIndex':source_index,'x':x,'y':y,'width':512,'height':512,'pivot':{'x':root,'y':root}})
        cells.append({'frame':index,'sourceVisibleBounds':source_bounds,'visibleBounds':bounds,'guardAlphaMax':guard,'registeredPreviewBounds':preview,'sha256':hashlib.sha256(frame.tobytes()).hexdigest()})
    assert len(set(c['sha256'] for c in cells))==6,(ident,'duplicate frames')
    out.save(ROOT/output_file)
    clip={'id':ident,'file':output_file,'label':labels[ident],'loop':ident in ['idle','running','charge'],'scale':DISPLAY_SCALE,'durations':timings[ident],'description':descriptions[ident],'frameCount':6,'sourceFrameOrder':order,'frames':frames}
    if ident in ['attack','charge-attack']:clip['impactFrame']=3
    clips.append(clip);checks.append({'clip':ident,'file':output_file,'size':[1536,1024],'mode':'RGBA','distinctFrames':6,'frames':cells})
    recipe.append({'clip':ident,'source':str(native.relative_to(ROOT)).replace('\\','/'),'sourceSha256':sha(native),'output':output_file,'outputSha256':sha(ROOT/output_file),'sourceGrid':[3,2],'sourceCellSize':[512,512],'uniformScale':SCALE,'destinationCellOffset':[OFFSET,OFFSET],'destinationCellSize':[512,512],'sourceRoot':[256,256],'sourceRowCuts':cuts,'framePlacements':placements})
    records.append({**record,'status':'selected-animation-source','nativeCopy':str(native.relative_to(ROOT)).replace('\\','/')})
metadata.update({'stage':'single-mounted-actor-art-prototype','integrationStatus':'Nine solo Early Medieval Rus Light Cavalry animations for visual review; runtime formations and gameplay integration are separate. Approved idle and previous Russian art are preserved.','sheetSize':{'width':1536,'height':1024},'grid':{'columns':3,'rows':2},'registration':'One common whole-canvas bake scale and fixed saddle/root pivots. No per-frame silhouette fitting.','deathVariants':['death','death-thrown'],'chargeAttack':'Overarm mounted spear thrust beside the horse, weapon retained','motionContract':'Local gait, spear poses, and recoil; gameplay owns world movement, formation placement, and combat timing.','animations':clips})
write(ROOT/'animations.json',metadata)
write(SOURCE/'Composition.json',{'date':'2026-10-07','authorization':'User authorized composing and baking existing sprites; single mounted actors only.','method':'Authored transparent row gutters, whole-pose uniform resize, and transparent atlas padding; native alpha retained, no painted pixels.','clips':recipe})
write(ROOT/'Validation.json',{'date':'2026-10-07','clipCount':9,'frameCount':54,'approvedIdlePreserved':sha(ROOT/'Idle-v1.png')==approved_hash,'userApproval':'Idle design approved before animation; animations pending visual review.','runtimeIntegration':False,'clips':checks})
generation=json.loads((ROOT/'Generation.json').read_text(encoding='utf-8'));existing={r.get('generatedSource') for r in generation['records']}
generation['records'] += [r for r in records if r['generatedSource'] not in existing]
generation['userApproval']='Idle design approved; nine animations pending visual review.'
generation['records'][0]['status']='approved-design-reference';write(ROOT/'Generation.json',generation)
html=(ROOT/'Actor_Review.html').read_text(encoding='utf-8').replace('One Rus lancer. One idle frame.','One Rus lancer. Nine motions.').replace('Idle design review','Single mounted actor review').replace('max="0"','max="5"').replace('1 / 1</output>','1 / 6</output>').replace('Loading lancer idle','Loading nine light cavalry sprite sheets')
(ROOT/'Actor_Review.html').write_text(html,encoding='utf-8')
print('Nine Early Medieval Rus Light Cavalry clips, 54 distinct frames: fixed roots, padding, preview bounds, and approved idle preservation pass.')
