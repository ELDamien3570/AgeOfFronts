"""Bake versioned overhead River Archer sheets while preserving prior art."""
from pathlib import Path
from PIL import Image
import json,hashlib,shutil
ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'SourceArt'
REVIEW=ROOT/'TopDownReview'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,d):p.write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
approved=sha(SOURCE/'Native-Idle-TopDown-v2.png')
generation=json.loads((SOURCE/'TopDown-Animation-Generation.json').read_text(encoding='utf-8-sig'))
labels={'idle':'Idle','running':'Walk','charge':'Charge in / maintain','attack':'Bow shot','charge-attack':'Advance, plant and shoot','reload':'Reload arrow','hit':'Get hit','charged':'Get charged','death':'Death - side fall','death-back':'Death - back fall'}
timings={'idle':[280]*6,'running':[160]*6,'charge':[90]*6,'attack':[140,180,260,100,180,250],'charge-attack':[140,180,260,100,180,250],'reload':[250,300,350,350,300,250],'hit':[100,90,130,130,160,180],'charged':[130,120,180,180,180,230],'death':[150,170,190,210,240,400],'death-back':[150,180,190,210,240,400]}
clips,checks,recipes=[],[],[]
for record in sorted(generation['records'],key=lambda r:list(labels).index(r['id'])):
    if record['status']!='selected-source':continue
    ident=record['id'];native=SOURCE/record['nativeFile']
    shutil.copy2(record['generatedSource'],native)
    im=Image.open(native).convert('RGBA');assert im.size==(1536,1024),(ident,im.size)
    out=Image.new('RGBA',im.size);frames,tracks,rows=[],[],[]
    for i in range(6):
        x,y=i%3*512,i//3*512
        source_index=record.get('cellIndices',{}).get(str(i),i)
        sx,sy=source_index%3*512,source_index//3*512
        cell_source=record.get('cellSources',{}).get(str(i),record['nativeFile'])
        source_im=Image.open(SOURCE/cell_source).convert('RGBA') if cell_source!=record['nativeFile'] else im
        cell=source_im.crop((sx,sy,sx+512,sy+512));a=cell.getchannel('A')
        edge=max(a.crop(r).getextrema()[1] for r in [(0,0,512,1),(0,511,512,512),(0,0,1,512),(511,0,512,512)])
        assert edge<=16,(ident,i,'source crosses cell boundary',edge)
        size=record.get('destinationSize',480);offset=(512-size)//2
        out.paste(cell.resize((size,size),Image.Resampling.LANCZOS),(x+offset,y+offset))
        pivot=record.get('pivots',[{'x':256,'y':256}]*6)[i]
        frames.append({'index':i,'x':x,'y':y,'width':512,'height':512,'pivot':pivot})
        baked=out.crop((x,y,x+512,y+512));a=baked.getchannel('A')
        bounds=a.point(lambda v:255 if v>16 else 0).getbbox();assert bounds
        guard=max(a.crop(r).getextrema()[1] for r in [(0,0,512,8),(0,504,512,512),(0,0,8,512),(504,0,512,512)]);assert guard==0
        rows.append({'index':i,'visibleBounds':bounds,'guardAlphaMax':guard,'nativeCellEdgeAlphaMax':edge,'sha256':hashlib.sha256(baked.tobytes()).hexdigest()})
        tracks.append({'index':i,'source':cell_source,'sourceSha256':sha(SOURCE/cell_source),'sourceRect':[sx,sy,sx+512,sy+512],'destinationSize':size,'offset':offset,'pivot':pivot})
    assert len({r['sha256'] for r in rows})==6,(ident,'duplicate frames')
    out.save(REVIEW/record['file'])
    clip={'id':ident,'label':labels[ident],'file':record['file'],'sha256':sha(REVIEW/record['file']),'loop':ident in ['idle','running','charge'],'scale':1,'durations':timings[ident],'description':record['action'],'frameCount':6,'frames':frames}
    if ident in ['attack','charge-attack']:clip.update({'releaseFrame':3,'weaponState':{'start':'arrow-ready','end':'empty-bow'}})
    if ident=='reload':clip['weaponState']={'start':'empty-bow','end':'arrow-ready'}
    clips.append(clip);checks.append({'id':ident,'frames':rows,'sha256':sha(REVIEW/record['file'])})
    recipes.append({'id':ident,'native':record['nativeFile'],'nativeSha256':sha(native),'output':record['file'],'tracks':tracks})
data=json.loads((REVIEW/'animations.json').read_text(encoding='utf-8-sig'))
data.update({'stage':'overhead-animation-review','animations':clips,'sheetSize':{'width':1536,'height':1024},'grid':{'columns':3,'rows':2},'shotSequence':['attack','reload','idle'],'chargeShotSequence':['charge-attack','reload','idle'],'projectileContract':'Runtime owns arrow projectile creation and timing. Release markers are visual references.'})
write(REVIEW/'animations.json',data)
assert sha(SOURCE/'Native-Idle-TopDown-v2.png')==approved
write(REVIEW/'Validation.json',{'clipCount':len(clips),'frameCount':len(clips)*6,'clips':checks,'failures':[],'approvedIdlePreserved':True,'runtimeIntegration':False,'userApproval':'Pending animation review'})
write(SOURCE/'TopDown-Composition.json',{'method':'Whole-pose cropping, uniform scale, transparent padding and authored roots. No pixel painting or alpha filtering.','clips':recipes})
write(REVIEW/'Generation.json',generation)
html=(REVIEW/'Actor_Review.html').read_text()
html=html.replace('River Archer · overhead idle','River Archer · ten overhead motions').replace('Matching bronze armor and leather, a wooden bow, bronze-tipped arrow, and no shield.','Bow shots, separate reload and two death variants.').replace('Overhead idle review','Overhead animation review')
(REVIEW/'Actor_Review.html').write_text(html)
print('Validated',len(clips),'clips /',len(clips)*6,'frames. Existing animation set preserved.')

