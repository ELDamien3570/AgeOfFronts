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
approved=ROOT/'Idle-Overhead-v2.png'; approved_hash=sha(approved)
write(SOURCE/'Approved-Idle.json',{'file':approved.name,'sha256':approved_hash,'approval':'User approved for animation on 2026-10-07.'})
labels={'idle':'Idle','running':'Walk','attack':'Overhand spear thrust','hit':'Get hit','charged':'Get charged','charge':'Charge in / maintain','charge-attack':'Charge attack','death':'Death - side fall','death-back':'Death - back fall'}
durations={'idle':[320]*6,'running':[160]*6,'attack':[130,150,150,100,170,240],'hit':[100,90,130,130,160,180],'charged':[130,120,180,180,180,230],'charge':[100]*6,'charge-attack':[130,160,180,100,200,250],'death':[150,170,190,210,240,400],'death-back':[150,180,190,210,240,400]}
descriptions={'idle':'Subtle breathing with planted feet and steady equipment.','running':'Alternating walking strides with the shield held in the left hand.','attack':'Draw back high, extend an overhand spear thrust, and recover.','hit':'Brief recoil and brace before recovering.','charged':'Heavy charge impact, deep stagger, and recovery.','charge':'Brisk running strides with a forward lean; loops to maintain charge.','charge-attack':'Plant the feet and deliver a heavy overhand spear thrust.','death':'Knees buckle, followed by a side collapse and settled corpse.','death-back':'Recoil and fall backward while lowering the held shield and spear.'}
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
  rect=rec.get("sourceRects",[])[i] if rec.get("sourceRects") else [col*512,row*512,(col+1)*512,(row+1)*512]
  size=(round((rect[2]-rect[0])*scale),round((rect[3]-rect[1])*scale))
  pose=im.crop(tuple(rect)).resize(size,Image.Resampling.LANCZOS)
  dx=padding+round((rect[0]-col*512)*scale);dy=padding+round((rect[1]-row*512)*scale)
  pack=rec.get("packingOffsets",[[0,0]]*6)[i]
  dx+=pack[0];dy+=pack[1]
  out.paste(pose,(col*512+dx,row*512+dy))
  root_offset=rec.get("rootOffsets",[[0,0]]*6)[i]
  frame={'index':i,'sourceIndex':i,'x':col*512,'y':row*512,'width':512,'height':512,'pivot':{'x':256+pack[0]+root_offset[0]*scale,'y':256+pack[1]+root_offset[1]*scale}}
  frames.append(frame)
  cell=out.crop((col*512,row*512,(col+1)*512,(row+1)*512));alpha=cell.getchannel('A')
  bounds=alpha.point(lambda v:255 if v>16 else 0).getbbox()
  assert bounds,(rec['id'],i,'empty')
  guard=max(alpha.crop(r).getextrema()[1] for r in [(0,0,512,8),(0,504,512,512),(0,0,8,512),(504,0,512,512)])
  assert guard==0,(rec['id'],i,guard)
  framechecks.append({'frame':i,'visibleBounds':bounds,'guardAlphaMax':guard,'sha256':hashlib.sha256(cell.tobytes()).hexdigest()})
  tracks.append({'frame':i,'sourceRect':rect,'uniformScale':scale,'destinationOffset':[dx,dy],'packingOffset':pack,'rootOffset':root_offset,'pivot':frame['pivot']})
 distinct=len({f['sha256'] for f in framechecks})
 assert distinct==6,(rec['id'],'duplicate frames')
 out.save(ROOT/rec['file'])
 ident=rec['id']
 clip={'id':ident,'file':rec['file'],'label':labels[ident],'loop':ident in ['idle','running','charge'],'scale':1,'durations':rec.get('durations',durations[ident]),'description':descriptions[ident],'frameCount':6,'frames':frames}
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
hist['approval']='Idle-Overhead-v2.png approved for animation; animation artwork pending review.'
hist['animations']=gen['records'];hist['stage']='single-actor-animation-review'
write(ROOT/'Generation.json',hist)
html=(SOURCE/'Before-Animation-Actor_Review.html').read_text(encoding='utf-8')
html=html.replace('Mail spearman. Idle design.','Mail spearman. Nine motions.').replace('Single idle frame review','Single actor animation review').replace('Idle artwork awaiting review','Animation artwork awaiting review').replace('Loading mail spearman idle frame','Loading animation sheets')
(ROOT/'Actor_Review.html').write_text(html,encoding='utf-8')
(ROOT/'README.md').write_text('# Russian Early Medieval Mail Spearman\n\nNine solo animation clips, six frames each: idle, walk, overhand spear thrust, get hit, get charged, charge running, charge attack, side death and backward death. Approved Idle-Overhead-v2.png and native ImageGen sources preserved. Full prompts in Generation.json and SourceArt/Animation-Generation.json. Editable whole-pose packing tracks in SourceArt/Composition.json; regenerate with SourceArt/compose_animations.py. No painted or alpha-filtered corrections. Animations await user review. Runtime formations and gameplay remain separate.\n',encoding='utf-8')
print('Nine clips, 54 frames; approved idle preserved, six distinct poses each, alpha guards clear.')
