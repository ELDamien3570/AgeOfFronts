"""Compose whole authored Shield Warrior poses without painting or alpha filtering."""
from pathlib import Path
from PIL import Image
import json,shutil,hashlib
ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'SourceArt'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,d):p.write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
gen=json.loads((SOURCE/'Animation-Generation.json').read_text())
data=json.loads((ROOT/'animations.json').read_text())
for name in ['animations.json','Validation.json','Browser-Review.json']:
    backup=SOURCE/('Before-Animation-'+name)
    if not backup.exists():shutil.copy2(ROOT/name,backup)
approved=ROOT/'Idle-Axe-TopSpike-v3.png';approved_hash=sha(approved)
write(SOURCE/'Approved-Idle.json',{'file':approved.name,'sha256':approved_hash,'approval':'Approved for animation by user on 2026-10-07.'})
labels={'idle':'Idle','running':'Walk','attack':'Axe chop','hit':'Get hit','charged':'Get charged','charge':'Charge in / maintain','charge-attack':'Charge attack','death':'Death - side fall','death-back':'Death - back fall'}
durations={'idle':[170]*6,'running':[160]*6,'attack':[140,180,180,100,180,250],'hit':[100,90,130,130,160,180],'charged':[130,120,180,180,180,230],'charge':[90]*6,'charge-attack':[130,190,180,100,180,250],'death':[150,170,190,210,240,400],'death-back':[150,180,190,210,240,400]}
descriptions={'idle':'Breathing and a gentle weight shift, with the axe held low.','running':'Alternating steps with the shield strapped securely to his back.','attack':'Wind up, chop with the axe edge, follow through, and recover.','hit':'A brief flinch, brace, and recovery.','charged':'A heavy impact forces a deeper stagger before he recovers.','charge':'Running strides with the axe ready and the shield on his back.','charge-attack':'Plant, raise the axe, deliver a heavy chop, and recover.','death':'Knees buckle before he falls onto his side and settles.','death-back':'Recoil, fall backward, and settle flat on the ground.'}
clips=[];recipes=[];checks=[]
durations['attack']=durations['charge-attack'].copy()
descriptions['attack']=descriptions['charge-attack']
for rec in gen['records']:
    native=SOURCE/rec['nativeFile']
    if not native.exists():shutil.copy2(rec['generatedSource'],native)
    if rec['status']!='selected-source':continue
    im=Image.open(native).convert('RGBA');assert im.size==(1536,1024),(rec['id'],im.size)
    replacements=[]
    for patch in rec.get('cellReplacements',[]):
        patch_file=SOURCE/patch['nativeFile'];cell=Image.open(patch_file).convert('RGBA')
        if cell.size!=(512,512):cell=cell.resize((512,512),Image.Resampling.LANCZOS)
        slot=patch['frame'];im.paste(cell,((slot%3)*512,(slot//3)*512))
        replacements.append({**patch,'sha256':sha(patch_file),'method':'Whole ImageGen-authored cell, uniformly resized to source cell dimensions.'})
    out=Image.new('RGBA',(1536,1024),(0,0,0,0)); frames=[];framechecks=[];tracks=[]
    scale=rec.get('uniformScale',.8);padding=rec.get('padding',44)
    for i in range(6):
        col,row=i%3,i//3;source_index=rec.get('sourceOrder',list(range(6)))[i];src_col,src_row=source_index%3,source_index//3
        rect=rec.get('sourceRects',[])[i] if rec.get('sourceRects') else [src_col*512,src_row*512,(src_col+1)*512,(src_row+1)*512]
        pose=im.crop(tuple(rect));size=[round(pose.width*scale),round(pose.height*scale)]
        dx=padding+round((rect[0]-src_col*512)*scale);dy=padding+round((rect[1]-src_row*512)*scale)
        if tuple(size)!=pose.size:pose=pose.resize(tuple(size),Image.Resampling.LANCZOS)
        out.paste(pose,(col*512+dx,row*512+dy))
        frame={'index':i,'sourceIndex':source_index,'x':col*512,'y':row*512,'width':512,'height':512,'pivot':{'x':248.8,'y':260.0}}
        frames.append(frame);cell=out.crop((col*512,row*512,(col+1)*512,(row+1)*512));a=cell.getchannel('A');bounds=a.point(lambda v:255 if v>16 else 0).getbbox();assert bounds
        guard=max(a.crop(r).getextrema()[1] for r in [(0,0,512,8),(0,504,512,512),(0,0,8,512),(504,0,512,512)])
        assert guard==0,(rec['id'],i,guard)
        framechecks.append({'frame':i,'visibleBounds':bounds,'guardAlphaMax':guard,'sha256':hashlib.sha256(cell.tobytes()).hexdigest()})
        tracks.append({'frame':i,'sourceRect':rect,'uniformScale':scale,'destinationOffset':[dx,dy],'sourceRoot':rec.get('sourceRoot',[256,270]),'pivot':frame['pivot']})
    distinct=len({f['sha256'] for f in framechecks});assert distinct>=rec.get('minimumDistinctFrames',6),rec['id']
    out.save(ROOT/rec['file']);ident=rec['id']
    c={'id':ident,'file':rec['file'],'label':labels[ident],'loop':ident in ['idle','running','charge'],'scale':1,'durations':durations[ident],'description':descriptions[ident],'frameCount':6,'frames':frames}
    if ident in ['attack','charge-attack']:c['impactFrame']=3
    clips.append(c);checks.append({'clip':ident,'file':rec['file'],'distinctFrames':distinct,'frames':framechecks});recipes.append({'clip':ident,'source':rec['nativeFile'],'sourceSha256':sha(native),'cellReplacements':replacements,'output':rec['file'],'outputSha256':sha(ROOT/rec['file']),'tracks':tracks})
assert len(clips)==9
clips.sort(key=lambda c:list(labels).index(c['id']))
data.update({'stage':'single-actor-animation-review','integrationStatus':'Local animation review; runtime formations and gameplay mechanics remain separate.','sheetSize':{'width':1536,'height':1024},'grid':{'columns':3,'rows':2},'registration':'Whole-pose source rectangles with recorded scale and padding, fixed root pivots, no silhouette fitting.','deathVariants':['death','death-back'],'animations':clips})
write(ROOT/'animations.json',data)
assert sha(approved)==approved_hash
write(ROOT/'Validation.json',{'date':'2026-10-07','actorCount':1,'clipCount':9,'frameCount':54,'approvedIdlePreserved':True,'eightPixelGuards':'Zero alpha','userApproval':'New animations pending visual review.','runtimeIntegration':False,'clips':checks})
write(SOURCE/'Composition.json',{'date':'2026-10-07','method':'Whole-pose crops, common scale and padding; no painted pixels or alpha filtering.','clips':recipes})
hist=json.loads((ROOT/'Generation.json').read_text());animation_sources={r['generatedSource'] for r in gen['records']}
hist['records']=[r for r in hist['records'] if r.get('generatedSource') not in animation_sources]
for r in hist['records']:
    if r.get('file')==approved.name:r['status']='approved-design-reference'
hist['records'] += gen['records']
hist['userApproval']='Idle-Axe-TopSpike-v3.png approved for animation; animations pending review.'
write(ROOT/'Generation.json',hist)
html=(ROOT/'Actor_Review.html').read_text(encoding='utf-8')
html=html.replace('One shield warrior. One idle frame.','One shield warrior. Nine motions.').replace('Single idle design review','Single actor animation review').replace('Idle design awaiting review','Animation artwork awaiting review').replace('max="0"','max="5"').replace('1 / 1</output>','1 / 6</output>')
(ROOT/'Actor_Review.html').write_text(html,encoding='utf-8')
print('Nine clips, 54 frame slots; approved idle preserved and atlas guards pass.')
