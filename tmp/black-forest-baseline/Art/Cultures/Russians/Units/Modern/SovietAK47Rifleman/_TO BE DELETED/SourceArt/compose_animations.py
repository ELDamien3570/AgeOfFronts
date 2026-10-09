"""Bake overhead solo AK-47 rifleman clips without replacing the approved idle or prior art."""
from pathlib import Path
from PIL import Image
import json, hashlib, shutil, urllib.request

ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'SourceArt'; REVIEW=ROOT
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,d): p.write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
approved=sha(SOURCE/'Native-Idle-TopDown-v2.png')
generation=json.loads((SOURCE/'Animation-Generation.json').read_text(encoding='utf-8-sig'))
labels={'idle':'Idle','running':'Walk','charge':'Charge in / maintain','attack':'Rifle fire','charge-attack':'Advance and fire','reload':'Magazine reload','hit':'Get hit','charged':'Get charged','death':'Death - side fall','death-back':'Death - back fall'}
timings={'idle':[280]*6,'running':[160]*6,'charge':[90]*6,'attack':[140,180,180,150,180,220],'charge-attack':[140,180,180,160,180,220],'reload':[250,300,350,400,350,250],'hit':[100,90,130,130,160,180],'charged':[130,120,180,180,180,230],'death':[150,170,190,210,240,400],'death-back':[150,180,190,210,240,400]}
for r in generation['records']:
    shutil.copy2(r['generatedSource'],SOURCE/r['nativeFile'])
selected=[r for r in generation['records'] if r['status']=='selected-source']
assert len(selected)==10 and len({r['id'] for r in selected})==10
clips,checks,recipes=[],[],[]
for record in sorted(selected,key=lambda r:list(labels).index(r['id'])):
    ident=record['id']; native=SOURCE/record['nativeFile']
    im=Image.open(native).convert('RGBA'); assert im.size==(1536,1024),(ident,im.size)
    out=Image.new('RGBA',im.size); frames,tracks,rows=[],[],[]
    for i in range(6):
        x,y=i%3*512,i//3*512
        source_index=record.get('cellIndices',{}).get(str(i),i)
        sx,sy=source_index%3*512,source_index//3*512
        cell_source=record.get('cellSources',{}).get(str(i),record['nativeFile'])
        source_im=Image.open(SOURCE/cell_source).convert('RGBA')
        cell=source_im.crop((sx,sy,sx+512,sy+512)); a=cell.getchannel('A')
        edge=max(a.crop(r).getextrema()[1] for r in [(0,0,512,1),(0,511,512,512),(0,0,1,512),(511,0,512,512)])
        assert edge<=16,(ident,i,'source crosses boundary',edge)
        size=record.get('destinationSize',480); offset=(512-size)//2
        crop=record.get('sourceCrop',[0,0,512,512])
        visible=a.point(lambda v:255 if v>16 else 0).getbbox()
        assert visible and crop[0]<=visible[0] and crop[1]<=visible[1] and crop[2]>=visible[2] and crop[3]>=visible[3],(ident,i,'crop cuts pose')
        assert crop[2]-crop[0]==crop[3]-crop[1]
        out.paste(cell.crop(crop).resize((size,size),Image.Resampling.LANCZOS),(x+offset,y+offset))
        pivot=record.get('pivots',[{'x':256,'y':256}]*6)[i]
        frames.append({'index':i,'x':x,'y':y,'width':512,'height':512,'pivot':pivot})
        baked=out.crop((x,y,x+512,y+512)); a=baked.getchannel('A')
        bounds=a.point(lambda v:255 if v>16 else 0).getbbox(); assert bounds
        guard=max(a.crop(r).getextrema()[1] for r in [(0,0,512,8),(0,504,512,512),(0,0,8,512),(504,0,512,512)]); assert guard==0
        rows.append({'index':i,'visibleBounds':bounds,'guardAlphaMax':guard,'nativeCellEdgeAlphaMax':edge,'sha256':hashlib.sha256(baked.tobytes()).hexdigest()})
        tracks.append({'index':i,'source':cell_source,'sourceSha256':sha(SOURCE/cell_source),'sourceRect':[sx+crop[0],sy+crop[1],sx+crop[2],sy+crop[3]],'destinationSize':size,'offset':offset,'pivot':pivot})
    assert len({r['sha256'] for r in rows})==6,(ident,'duplicate poses')
    out.save(REVIEW/record['file'])
    clip={'id':ident,'label':labels[ident],'file':record['file'],'sha256':sha(REVIEW/record['file']),'loop':ident in ['idle','running','charge'],'scale':record.get('scale',1),'durations':timings[ident],'description':record['action'],'frameCount':6,'frames':frames}
    if ident=='charge-attack': clip['impactFrame']=3
    if ident=='attack': clip.update({'releaseFrame':3,'weaponState':{'start':'loaded','end':'fired'}})
    if ident=='reload': clip['weaponState']={'start':'fired','end':'loaded'}
    clips.append(clip); checks.append({'id':ident,'frames':rows,'sha256':sha(REVIEW/record['file'])})
    recipes.append({'id':ident,'native':record['nativeFile'],'nativeSha256':sha(native),'output':record['file'],'tracks':tracks})
data=json.loads((REVIEW/'animations.json').read_text(encoding='utf-8-sig'))
data.update({'stage':'overhead-animation-review','reviewFootprint':320,'animations':clips,'sheetSize':{'width':1536,'height':1024},'grid':{'columns':3,'rows':2},'registration':'Authored roots, uniform whole-pose scaling and transparent padding.','shotSequence':['attack','idle'],'reloadSequence':['reload','idle'],'motionContract':'Gameplay owns formations, movement, damage and projectile creation.','deathVariants':['death','death-back']})
assert all(data['reviewFootprint']*c['scale']<=512 for c in clips),'preview frame exceeds canvas'
write(REVIEW/'animations.json',data)
assert sha(SOURCE/'Native-Idle-TopDown-v2.png')==approved
write(REVIEW/'Validation.json',{'clipCount':len(clips),'frameCount':len(clips)*6,'clips':checks,'failures':[],'approvedIdlePreserved':True,'runtimeIntegration':False,'userApproval':'Pending animation review'})
write(SOURCE/'Composition.json',{'method':'Whole-pose crops, uniform scaling, transparent padding and authored roots. No pixel painting or alpha filtering.','clips':recipes})
write(REVIEW/'Generation.json',generation)
html=(REVIEW/'Actor_Review.html').read_text(encoding='utf-8-sig').replace('Solo idle design review','Solo animation review').replace('Loading Soviet rifleman idle','Loading Soviet rifleman animations')
(REVIEW/'Actor_Review.html').write_text(html,encoding='utf-8')
base='http://127.0.0.1:9007/Cultures/Russians/Units/Modern/SovietAK47Rifleman/'
http=[]
for name in ['Actor_Review.html','animations.json','../../StoneAge/Clubman/actor-review.js']+[c['file'] for c in clips]:
    with urllib.request.urlopen(base+name) as response:
        assert response.status==200
        http.append({'file':name,'status':200,'bytes':len(response.read())})
write(REVIEW/'Browser-Review.json',{'httpChecks':http,'browserPlaybackVerified':False,'userApproval':'Pending animation review','runtimeIntegration':False})
print('Validated',len(clips),'clips /',len(clips)*6,'frames; HTTP resources pass. Live playback unverified.')

