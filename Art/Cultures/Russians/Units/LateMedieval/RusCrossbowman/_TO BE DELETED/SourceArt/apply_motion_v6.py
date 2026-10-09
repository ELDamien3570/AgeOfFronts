"""Register idle anchors and replace both shot recovery cells as whole poses."""
from pathlib import Path
from PIL import Image
import json,hashlib,shutil
ROOT=Path(__file__).resolve().parent.parent;SOURCE=ROOT/'SourceArt'
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,d):p.write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
generation=read(SOURCE/'Motion-v6-Generation.json');data=read(ROOT/'animations.json');validation=read(ROOT/'Validation.json')
backup=SOURCE/'Before-Motion-v6-animations.json'
if not backup.exists():shutil.copy2(ROOT/'animations.json',backup)
baseline=read(backup)
unrelated={c['file']:sha(ROOT/c['file']) for c in data['animations'] if c['id'] not in ['idle','attack','charge-attack']}
approved=sha(ROOT/'Idle-String-v5.png');recipes=[]
for ident in ['idle','attack','charge-attack']:
    clip=next(c for c in data['animations'] if c['id']==ident)
    old=next(c for c in baseline['animations'] if c['id']==ident)
    record=next(r for r in generation['records'] if r['id']==('idle' if ident=='idle' else 'attack') and r['status']=='selected-source')
    native=Image.open(SOURCE/record['nativeFile']).convert('RGBA');assert native.size==(1536,1024)
    out=Image.new('RGBA',native.size) if ident=='idle' else Image.open(ROOT/old['file']).convert('RGBA').copy()
    clip['frames']=json.loads(json.dumps(old['frames']))
    for i in (range(6) if ident=='idle' else [5]):
        x,y=i%3*512,i//3*512
        pose=native.crop((x,y,x+512,y+512)).resize((496,496),Image.Resampling.LANCZOS)
        out.paste(Image.new('RGBA',(512,512)),(x,y));out.paste(pose,(x+8,y+8))
        pivot=clip['frames'][i]['pivot']
        clip['frames'][i]['pivot']={'x':8+(generation['idleHelmetAnchorsX'][i] if ident=='idle' else pivot['x'])*496/512,'y':8+pivot['y']*496/512}
    filename=ident+'-motion-v6.png';out.save(ROOT/filename);clip['file']=filename
    if ident=='idle':clip['description']='Subtle breathing with the helmet registered to a fixed lateral anchor and loaded crossbow held steady.';clip['durations']=[280]*6
    rows=[]
    for i in range(6):
        x,y=i%3*512,i//3*512;cell=out.crop((x,y,x+512,y+512));a=cell.getchannel('A');b=a.point(lambda v:255 if v>16 else 0).getbbox();assert b
        guard=max(a.crop(r).getextrema()[1] for r in [(0,0,512,8),(0,504,512,512),(0,0,8,512),(504,0,512,512)]);assert guard==0
        rows.append({'index':i,'visibleBounds':b,'guardAlphaMax':guard,'sha256':hashlib.sha256(cell.tobytes()).hexdigest()})
    assert len({r['sha256'] for r in rows})==6
    check=next(c for c in validation['clips'] if c['clip']==ident);check.update(file=filename,frames=rows,sha256=sha(ROOT/filename))
    recipes.append({'clip':ident,'source':record['nativeFile'],'baseSheet':old['file'],'replacedFrames':list(range(6)) if ident=='idle' else [5],'cellSize':[496,496],'padding':8,'frames':clip['frames']})
assert sha(ROOT/'Idle-String-v5.png')==approved and all(sha(ROOT/f)==h for f,h in unrelated.items())
write(ROOT/'animations.json',data);validation['motionV6']='Idle lateral anchors and rigid shot recovery; seven other sheets unchanged.';write(ROOT/'Validation.json',validation);write(SOURCE/'Motion-v6-Composition.json',{'clips':recipes})
history=read(ROOT/'Generation.json');known={r.get('generatedSource') for r in history['records']};history['records'] += [r for r in generation['records'] if r['generatedSource'] not in known];write(ROOT/'Generation.json',history)
print('Three revised clips validated; other seven sheets and approved idle unchanged.')
