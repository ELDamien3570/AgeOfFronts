"""Bake complete ImageGen-authored poses, preserving the approved idle and native sources."""
from pathlib import Path
from PIL import Image
import json,shutil,hashlib
ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'SourceArt'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,d): p.write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
gen=json.loads((SOURCE/'Animation-Generation.json').read_text(encoding='utf-8'))
data=json.loads((SOURCE/'Before-Animation-animations.json').read_text(encoding='utf-8'))
approved=ROOT/'Idle-v1.png'; approved_hash=sha(approved)
write(SOURCE/'Approved-Idle.json',{'file':approved.name,'sha256':approved_hash,'approval':'User approved for animation on 2026-10-07.'})
labels={'idle':'Idle','running':'Walk','attack':'Pike thrust','hit':'Get hit','charged':'Get charged','charge':'Charge in / maintain','charge-attack':'Charge attack','death':'Death - side fall','death-back':'Death - back fall'}
durations={'idle':[170]*6,'running':[160]*6,'attack':[130,150,150,100,170,240],'hit':[100,90,130,130,160,180],'charged':[130,120,180,180,180,230],'charge':[90]*6,'charge-attack':[130,160,180,100,200,250],'death':[150,170,190,210,240,400],'death-back':[150,180,190,210,240,400]}
descriptions={'idle':'Breathing and a gentle weight shift, with the shield held and the pike ready.','running':'Alternating walking steps with the pike and held shield steady.','attack':'Draw back, brace, thrust the pike forward, and recover.','hit':'Brief flinch and shield brace before recovering.','charged':'A heavier charge impact causes a deep stagger before recovery.','charge':'Running strides with the pike forward and the shield held close.','charge-attack':'Plant the feet, brace the shield, and deliver a powerful pike thrust.','death':'Knees buckle before a side fall and settled corpse.','death-back':'Recoil, fall backward, and settle on the back without changing orientation.'}
clips=[];recipes=[];checks=[]
for rec in gen['records']:
 native=SOURCE/rec['nativeFile']
 if not native.exists(): shutil.copy2(rec['generatedSource'],native)
 if rec['status']!='selected-source':continue
 im=Image.open(native)
 assert im.mode=='RGBA',(rec['id'],im.mode)
 assert im.size==(1536,1024),(rec['id'],im.size)
 out=Image.new('RGBA',im.size,(0,0,0,0)); frames=[];framechecks=[];tracks=[]
 scale=.9;padding=25
 for i in range(6):
  col,row=i%3,i//3
  rect=[col*512,row*512,(col+1)*512,(row+1)*512]
  pose=im.crop(tuple(rect)).resize((461,461),Image.Resampling.LANCZOS)
  out.paste(pose,(col*512+padding,row*512+padding))
  frame={'index':i,'sourceIndex':i,'x':col*512,'y':row*512,'width':512,'height':512,'pivot':{'x':256,'y':256}}
  frames.append(frame)
  cell=out.crop(tuple(rect));alpha=cell.getchannel('A')
  bounds=alpha.point(lambda v:255 if v>16 else 0).getbbox()
  assert bounds,(rec['id'],i,'empty')
  guard=max(alpha.crop(r).getextrema()[1] for r in [(0,0,512,8),(0,504,512,512),(0,0,8,512),(504,0,512,512)])
  assert guard==0,(rec['id'],i,guard)
  framechecks.append({'frame':i,'visibleBounds':bounds,'guardAlphaMax':guard,'sha256':hashlib.sha256(cell.tobytes()).hexdigest()})
  tracks.append({'frame':i,'sourceRect':rect,'uniformScale':scale,'destinationOffset':[padding,padding],'pivot':frame['pivot']})
 distinct=len({f['sha256'] for f in framechecks})
 assert distinct==6,(rec['id'],'duplicate frames')
 out.save(ROOT/rec['file'])
 ident=rec['id']
 clip={'id':ident,'file':rec['file'],'label':labels[ident],'loop':ident in ['idle','running','charge'],'scale':1,'durations':durations[ident],'description':descriptions[ident],'frameCount':6,'frames':frames}
 if ident in ['attack','charge-attack']:clip['impactFrame']=3
 clips.append(clip)
 checks.append({'clip':ident,'file':rec['file'],'distinctFrames':distinct,'frames':framechecks})
 recipes.append({'clip':ident,'source':rec['nativeFile'],'sourceSha256':sha(native),'output':rec['file'],'outputSha256':sha(ROOT/rec['file']),'tracks':tracks})
assert len(clips)==9
clips.sort(key=lambda c:list(labels).index(c['id']))
data.update({'stage':'single-actor-animation-review','integrationStatus':'Local artwork review; runtime formations and gameplay are separate.','sheetSize':{'width':1536,'height':1024},'grid':{'columns':3,'rows':2},'reviewFootprint':460,'registration':'Whole authored poses with common scale, padding and fixed root.','deathVariants':['death','death-back'],'animations':clips})
write(ROOT/'animations.json',data)
assert sha(approved)==approved_hash
write(ROOT/'Validation.json',{'date':'2026-10-07','actorCount':1,'clipCount':9,'frameCount':54,'approvedIdlePreserved':True,'eightPixelGuards':'Zero alpha','userApproval':'Animations pending visual review.','runtimeIntegration':False,'clips':checks})
write(SOURCE/'Composition.json',{'date':'2026-10-07','method':'Whole ImageGen-authored poses, common scale and padding; no painting or alpha filtering.','clips':recipes})
hist=json.loads((SOURCE/'Before-Animation-Generation.json').read_text(encoding='utf-8'))
hist['approval']='Idle-v1.png approved for animation; animation artwork pending review.'
hist['animations']=gen['records'];hist['stage']='single-actor-animation-review'
write(ROOT/'Generation.json',hist)
html=(SOURCE/'Before-Animation-Actor_Review.html').read_text(encoding='utf-8')
html=html.replace('One pikeman. Idle design.','One pikeman. Nine motions.').replace('Single idle frame review','Single actor animation review').replace('Idle artwork awaiting review','Animation artwork awaiting review').replace('Loading pikeman idle frame','Loading pikeman animation sheets').replace('max="0"','max="5"').replace('1 / 1</output>','1 / 6</output>')
(ROOT/'Actor_Review.html').write_text(html,encoding='utf-8')
(ROOT/'README.md').write_text('# Russian Classical Age Pikeman\n\nNine solo animation clips, six frames each: idle, walk, pike thrust, get hit, get charged, charge running, charge thrust, side death and backward death.\n\nApproved Idle-v1.png and all native ImageGen sources are preserved. SourceArt/Animation-Generation.json records full prompts and references. SourceArt/Composition.json records editable whole-pose bake recipes. Regenerate the review sheets with SourceArt/compose_animations.py. No painted corrections, silhouette fitting or alpha filtering.\n\nAnimations await user visual approval; runtime instancing and gameplay remain separate.\n',encoding='utf-8')
print('Nine clips, 54 frames; approved idle preserved, six distinct poses each, alpha guards clear.')
