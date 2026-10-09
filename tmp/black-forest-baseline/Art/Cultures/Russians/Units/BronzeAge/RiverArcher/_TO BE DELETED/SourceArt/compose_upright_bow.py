"""Bake revised whole shooting poses, preserving all other clips and timings."""
from pathlib import Path
from PIL import Image
import json,shutil,hashlib

ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'SourceArt'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def write(path,data):path.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
generation=json.loads((SOURCE/'Upright-Bow-Generation.json').read_text())
data=json.loads((ROOT/'animations.json').read_text())
validation=json.loads((ROOT/'Validation.json').read_text())
preserved={c['file']:sha(ROOT/c['file']) for c in data['animations'] if c['id'] not in ['attack','charge-attack']}
preserved['Idle-v1.png']=sha(ROOT/'Idle-v1.png')
for name in ['animations.json','Validation.json','Browser-Review.json']:
    dest=SOURCE/('Before-Upright-Bow-'+name)
    if not dest.exists():shutil.copy2(ROOT/name,dest)
recipe=[]
for record in generation['records']:
    native=SOURCE/record['nativeFile']
    if not native.exists():shutil.copy2(record['generatedSource'],native)
    if record['status']!='selected-source':continue
    ident=record['clip'];clip=next(c for c in data['animations'] if c['id']==ident)
    im=Image.open(native).convert('RGBA');assert im.size==(1536,1024)
    out=Image.new('RGBA',(1536,1024),(0,0,0,0))
    checks,tracks=[],[]
    for i in range(6):
        col,row=i%3,i//3;rect=(col*512,row*512,(col+1)*512,(row+1)*512)
        size=record.get('bakeSize',[512,512]); offset=record.get('bakeOffset',[0,0])
        pose=im.crop(rect).resize(tuple(size),Image.Resampling.LANCZOS)
        out.paste(pose,(col*512+offset[0],row*512+offset[1]))
        cell=out.crop(rect);a=cell.getchannel('A');bounds=a.point(lambda v:255 if v>16 else 0).getbbox();assert bounds is not None
        guard=max(a.crop(r).getextrema()[1] for r in [(0,0,512,8),(0,504,512,512),(0,0,8,512),(504,0,512,512)])
        assert guard<=1,(ident,i,guard)
        x,y=clip['frames'][i]['pivot']['x'],clip['frames'][i]['pivot']['y'];l,t,r,b=bounds;s=400/512
        preview=[256+(l-x)*s,256+(t-y)*s,256+(r-x)*s,256+(b-y)*s];assert min(preview)>=0 and max(preview)<=512
        checks.append({'frame':i,'visibleBounds':bounds,'guardAlphaMax':guard,'guardAlphaTolerance':1,'registeredPreviewBounds':preview,'sha256':hashlib.sha256(cell.tobytes()).hexdigest()})
        tracks.append({'index':i,'sourceRect':list(rect),'destinationOffset':offset,'sourceSize':[512,512],'destinationSize':size,'sourceRoot':record.get('sourceRoot',[248.8,260]),'pivot':clip['frames'][i]['pivot']})
    assert len(set(c['sha256'] for c in checks))==6
    out.save(ROOT/record['file'])
    clip['file']=record['file']
    clip['description']='Turn side-on, extend the bow arm, open the chest and draw back to the anchor, release, follow through, then turn back to ready.' if ident=='attack' else 'Finish advancing, plant and pivot side-on, extend the bow arm and open the chest for a full draw, release, follow through and recover.'
    entry=next(c for c in validation['clips'] if c['clip']==ident);entry.update({'file':record['file'],'frames':checks,'distinctFrames':6})
    recipe.append({'clip':ident,'nativeSource':native.name,'nativeSha256':sha(native),'output':record['file'],'outputSha256':sha(ROOT/record['file']),'tracks':tracks})
write(ROOT/'animations.json',data)
assert all(sha(ROOT/name)==value for name,value in preserved.items())
validation['uprightBowCorrection']={'updatedClips':['attack','charge-attack'],'preservedOtherClipsAndIdle':True,'timingsAndPivots':'Preserved','userApproval':'Pending revised shot review.'}
write(ROOT/'Validation.json',validation)
write(SOURCE/'Upright-Bow-Bake.json',{'date':'2026-10-07','method':'Whole-pose registered cells copied at native scale; no painted pixels or alpha filtering in code.','clips':recipe,'preservedHashes':preserved})
history=json.loads((ROOT/'Generation.json').read_text());existing={r.get('generatedSource') for r in history['records']}
for r in history['records']:
    if r.get('id') in ['attack','charge-attack'] and r.get('file') in ['Attack-v1.png','Charge-Attack-v1.png']:r['status']='superseded-square-body-shot'
for old in history['records']:
    match=next((r for r in generation['records'] if r['generatedSource']==old.get('generatedSource')),None)
    if match:old.update(match)
history['records'] += [r for r in generation['records'] if r['generatedSource'] not in existing]
history['uprightBowCorrection']='User confirmed upright bow plane, foreshortened from overhead, with string beside forearm and straight arrow. Prompt and bake records in SourceArt/Upright-Bow-Generation.json and Upright-Bow-Bake.json.'
write(ROOT/'Generation.json',history)
print('Upright bow shots: 12 distinct poses; borders and preview bounds pass. Other seven clips, idle source, timings and pivots preserved.')

