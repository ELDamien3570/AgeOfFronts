"""Bake whole generated poses using one uniform scale; retain native sources."""
from pathlib import Path
from PIL import Image
import json, hashlib, shutil

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'SourceArt'
SCALE = 0.80
OFFSET = 50

def write(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

generation = json.loads((SOURCE / 'Animation-Generation.json').read_text())
selected = [r for r in generation['records'] if r['status'] == 'selected-source']
previous = json.loads((ROOT / 'animations.json').read_text())
for name in ['animations.json', 'Validation.json', 'Browser-Review.json']:
    backup = SOURCE / ('Before-Animation-' + name)
    if not backup.exists():
        shutil.copy2(ROOT / name, backup)
approved_hash = sha(ROOT / 'Idle-LargeShield-v3.png')
write(SOURCE / 'Approved-Idle.json', {'file':'Idle-LargeShield-v3.png', 'sha256':approved_hash, 'userApproval':'Approved before animation on 2026-10-07'})

labels = {'idle':'Idle', 'running':'Walk', 'attack':'Spear thrust', 'hit':'Get hit', 'charged':'Get charged', 'charge':'Charge in / maintain', 'charge-attack':'Charge attack', 'death':'Death - side fall', 'death-back':'Death - back fall'}
descriptions = {
 'idle':'Breathing and weight settle with the rear spear grip and large round shield.',
 'running':'Alternating walking steps with spear and shield carried steadily.',
 'attack':'Draw back, thrust forward, and recover behind the large shield.',
 'hit':'Brief shield lift and torso recoil, then return to guard.',
 'charged':'Heavy shield impact, stagger, crouch, and recovery.',
 'charge':'Faster alternating strides. Gameplay supplies world movement and formation placement.',
 'charge-attack':'Plant, lunge into a heavy forward spear thrust, then recover.',
 'death':'Knees buckle, body rolls onto its side, and settles into a held final pose.',
 'death-back':'Recoil, buckle, fall face up, and settle. Head stays screen-top through the final poses.'}
durations = {'idle':[170]*6, 'running':[160]*6, 'attack':[130,180,160,100,180,240], 'hit':[100,90,130,130,160,180], 'charged':[130,120,180,180,180,230], 'charge':[90]*6, 'charge-attack':[130,190,160,100,180,240], 'death':[150,170,190,210,240,400], 'death-back':[150,180,190,210,240,400]}
# Authored gutters isolate complete poses when the generator straddles a 512px row boundary.
row_cuts = {'running':[490,500,490], 'attack':[512,480,512], 'charge-attack':[470,512,512]}
clips, recipe, checks = [], [], []
for record in selected:
    ident = record['id']
    native = SOURCE / ('Native-' + record['file'])
    if not native.exists():
        shutil.copy2(record['generatedSource'], native)
    im = Image.open(native).convert('RGBA')
    assert im.size == (1536,1024), (ident,im.size)
    sheet = Image.new('RGBA', (1536,1024), (0,0,0,0))
    frames, tracks, frame_checks = [], [], []
    for index in range(6):
        col, row = index % 3, index // 3
        left, right = col*512, (col+1)*512
        if ident == 'death':
            left = [0,512,1040][col]
            right = [512,1040,1536][col]
        cut = row_cuts.get(ident,[512]*3)[col]
        top, bottom = (0,cut) if row == 0 else (cut,1024)
        rect = (left,top,right,bottom)
        pose = im.crop(rect)
        target_size = (round(pose.width*SCALE), round(pose.height*SCALE))
        pose = pose.resize(target_size, Image.Resampling.LANCZOS)
        local_x = OFFSET + round((left-col*512)*SCALE)
        local_y = OFFSET + round((top-row*512)*SCALE)
        sheet.paste(pose,(col*512+local_x,row*512+local_y))
        frame = {'index':index,'sourceIndex':index,'x':col*512,'y':row*512,'width':512,'height':512,'pivot':{'x':OFFSET+256*SCALE,'y':OFFSET+280*SCALE}}
        frames.append(frame)
        tracks.append({'index':index,'sourceRect':list(rect),'uniformScale':SCALE,'destinationOffset':[local_x,local_y],'sourceRoot':[col*512+256,row*512+280]})
        cell = sheet.crop((col*512,row*512,(col+1)*512,(row+1)*512))
        alpha = cell.getchannel('A')
        bounds = alpha.point(lambda v:255 if v>16 else 0).getbbox()
        guard = max(alpha.crop(r).getextrema()[1] for r in [(0,0,512,8),(0,504,512,512),(0,0,8,512),(504,0,512,512)])
        frame_checks.append({'frame':index,'visibleBounds':bounds,'guardAlphaMax':guard,'sha256':hashlib.sha256(cell.tobytes()).hexdigest()})
        assert guard == 0, (ident,index,guard)
        assert bounds is not None
    sheet.save(ROOT / record['file'])
    clip = {'id':ident,'file':record['file'],'label':labels[ident],'loop':ident in ['idle','running','charge'],'scale':1,'durations':durations[ident],'description':descriptions[ident],'frameCount':6,'sourceFrameOrder':list(range(6)),'frames':frames}
    if ident in ['attack','charge-attack']: clip['impactFrame'] = 3
    clips.append(clip)
    recipe.append({'clip':ident,'source':str(native.relative_to(ROOT)).replace('\\','/'),'sourceSha256':sha(native),'output':record['file'],'outputSha256':sha(ROOT/record['file']),'tracks':tracks})
    checks.append({'clip':ident,'file':record['file'],'mode':'RGBA','size':[1536,1024],'distinctFrames':len(set(f['sha256'] for f in frame_checks)),'frames':frame_checks})

previous.update({'stage':'single-actor-art-prototype','integrationStatus':'Solo actor animation review; runtime formations and gameplay integration are separate.','sheetSize':{'width':1536,'height':1024},'grid':{'columns':3,'rows':2},'reviewFootprint':400,'registration':'Authored source rectangles, one uniform bake scale of 0.80 across all clips, and a fixed body/root pivot. No per-frame silhouette fitting.','deathVariants':['death','death-back'],'motionContract':'Local gait and spear poses; gameplay owns world movement, formation placement, and attack authorization.','animations':clips})
write(ROOT / 'animations.json', previous)
write(SOURCE / 'Composition.json', {'date':'2026-10-07','authorization':'User authorized composing and baking existing sprites; single actors only.','method':'Whole-pose crop, uniform scale, transparent atlas padding. No painted pixels or alpha cleanup in code.','clips':recipe})
write(ROOT / 'Validation.json', {'date':'2026-10-07','actorCount':1,'clipCount':len(clips),'frameCount':sum(c['frameCount'] for c in clips),'approvedIdlePreserved':sha(ROOT/'Idle-LargeShield-v3.png')==approved_hash,'eightPixelGuard':'All cells have zero alpha on all four eight-pixel guards.','visualApproval':'Approved idle design; new animations pending user review.','runtimeIntegration':False,'clips':checks})
history = json.loads((ROOT / 'Generation.json').read_text())
history['userApproval']='Idle-LargeShield-v3.png design approved; animations pending user review.'
for record in history['records']:
    if record['file']=='Idle-LargeShield-v3.png': record['status']='approved-design-reference'
existing_sources = {r.get('generatedSource') for r in history['records']}
history['records'] += [{**r,'references':[r['reference']],'status':'selected-animation-source' if r['status']=='selected-source' else r['status']} for r in generation['records'] if r['generatedSource'] not in existing_sources]
write(ROOT / 'Generation.json', history)
html = (ROOT / 'Actor_Review.html').read_text(encoding='utf-8')
html = html.replace('One spearman. One idle frame.','One spearman. Nine motions.').replace('Idle design review','Single actor animation review').replace('max="0"','max="5"').replace('1 / 1</output>','1 / 6</output>')
(ROOT / 'Actor_Review.html').write_text(html,encoding='utf-8')
print(json.dumps({'clips':len(clips),'frames':54,'approvedIdlePreserved':True,'guardsPassed':True}))
