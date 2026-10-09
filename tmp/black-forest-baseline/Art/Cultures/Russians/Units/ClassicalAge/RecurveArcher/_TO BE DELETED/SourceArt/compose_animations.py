"""Bake whole sprite poses at one fixed scale, preserving the approved master."""
from pathlib import Path
from PIL import Image
import hashlib,json,shutil
ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'SourceArt'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,d):p.write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
for name in ['animations.json','Validation.json','Browser-Review.json']:
    backup=SOURCE/('Before-Animation-'+name)
    if not backup.exists():shutil.copy2(ROOT/name,backup)
approved=sha(ROOT/'Idle-v1.png')
write(SOURCE/'Approved-Idle.json',{'file':'Idle-v1.png','sha256':approved,'approval':'User approved for animation.'})
data=json.loads((SOURCE/'Before-Animation-animations.json').read_text())
generation=json.loads((SOURCE/'Animation-Generation.json').read_text())
labels={'idle':'Idle','running':'Walk','attack':'Bow shot','reload':'Reload arrow','hit':'Get hit','charged':'Get charged','charge':'Charge in / maintain','charge-attack':'Advance, plant and shoot','death':'Death - side fall','death-back':'Death - back fall'}
durations={'idle':[170]*6,'running':[160]*6,'attack':[140,180,260,100,180,250],'reload':[120,170,180,200,180,220],'hit':[100,90,130,130,160,180],'charged':[130,120,180,180,180,230],'charge':[90]*6,'charge-attack':[140,200,260,100,180,250],'death':[150,170,190,210,240,400],'death-back':[150,180,190,210,240,400]}
descriptions={'idle':'Subtle breathing with bow and arrow ready.','running':'Alternating walking strides, bow carried low.','attack':'Turn side-on, draw and shoot straight forward toward screen-bottom, then follow through. Arrow reload is separate.','reload':'Reach to the quiver, extract one arrow, bring it around and nock it.','hit':'Brief recoil and recovery with equipment retained.','charged':'Heavy impact, backward stumble, crouch and regain balance.','charge':'Sustained running with full alternating strides and bow secure.','charge-attack':'Brake, plant, pivot side-on and shoot straight forward toward screen-bottom. Reload is separate.','death':'Knees buckle, fall onto the side and hold the settled body.','death-back':'Recoil, buckle and fall onto the back; head remains screen-top through settling.'}
clips,checks,recipes=[],[],[]
generation['records'].sort(key=lambda record:list(labels).index(record['id']))
for record in generation['records']:
    if record.get('status','selected-source')!='selected-source':continue
    ident=record['id'];native=SOURCE/record['nativeFile']
    im=Image.open(native).convert('RGBA');assert im.size==(1536,1024),(ident,im.size)
    out=Image.new('RGBA',im.size);frames,tracks,rows=[],[],[]
    for i in range(6):
        x,y=i%3*512,i//3*512;rect=(x,y,x+512,y+512)
        pose=im.crop(rect).resize((410,410),Image.Resampling.LANCZOS);out.paste(pose,(x+44,y+44))
        pivot=record.get('pivots',[{'x':248.8,'y':260}]*6)[i]
        frames.append({'index':i,'x':x,'y':y,'width':512,'height':512,'pivot':pivot})
        a=out.crop(rect).getchannel('A');b=a.point(lambda v:255 if v>16 else 0).getbbox();assert b
        guard=max(a.crop(r).getextrema()[1] for r in [(0,0,512,8),(0,504,512,512),(0,0,8,512),(504,0,512,512)]);assert guard==0
        preview=[256+(b[j]-pivot['x' if j%2==0 else 'y'])*400/512 for j in range(4)];assert min(preview)>=0 and max(preview)<=512
        rows.append({'index':i,'visibleBounds':b,'guardAlphaMax':guard,'registeredPreviewBounds':preview,'sha256':hashlib.sha256(out.crop(rect).tobytes()).hexdigest()})
        tracks.append({'index':i,'sourceRect':rect,'destinationSize':[410,410],'offset':[44,44],'pivot':pivot})
    assert len({r['sha256'] for r in rows})==6,(ident,'duplicate frames')
    out.save(ROOT/record['file'])
    clip={'id':ident,'file':record['file'],'label':labels[ident],'loop':ident in ['idle','running','charge'],'scale':1,'durations':durations[ident],'description':descriptions[ident],'frameCount':6,'frames':frames}
    if ident in ['attack','charge-attack']:clip.update({'releaseFrame':3,'weaponState':{'start':'arrow-nocked','end':'bow-only'}})
    if ident=='reload':clip['weaponState']={'start':'bow-only','end':'arrow-nocked'}
    clips.append(clip);checks.append({'clip':ident,'file':record['file'],'distinctFrames':6,'frames':rows,'sha256':sha(ROOT/record['file'])})
    recipes.append({'id':ident,'source':record['nativeFile'],'nativeSha256':sha(native),'output':record['file'],'tracks':tracks})
data.update({'stage':'single-actor-animation-review','integrationStatus':'Local art review. Runtime formations, combat and projectile integration are separate.','sheetSize':{'width':1536,'height':1024},'grid':{'columns':3,'rows':2},'animations':clips,'projectileContract':'Actor release markers are visual references; runtime owns projectile creation, ammunition and reload timing.','shotSequence':['attack','reload','idle'],'chargeShotSequence':['charge-attack','reload','idle']})
write(ROOT/'animations.json',data)
assert sha(ROOT/'Idle-v1.png')==approved
write(ROOT/'Validation.json',{'clips':checks,'clipCount':len(clips),'frameCount':len(clips)*6,'failures':[],'approvedIdlePreserved':True,'userApproval':'Pending animation review','runtimeIntegration':False})
write(SOURCE/'Composition.json',{'method':'Whole-pose cells, uniform scale and authored roots; no pixel painting or alpha filtering.','clips':recipes})
history=json.loads((ROOT/'Generation.json').read_text());known={r.get('generatedSource') for r in history['records']};history['records'] += [r for r in generation['records'] if r['generatedSource'] not in known];history['userApproval']='Idle approved; animations pending user review.';write(ROOT/'Generation.json',history)
print(f'Validated {len(clips)} clips / {len(clips)*6} frames; approved idle unchanged.')

