"""Select a single held idle pose with no frame-to-frame motion."""
from pathlib import Path
from PIL import Image
from urllib.request import urlopen
import hashlib, json, shutil

root=Path(__file__).resolve().parent.parent
source=root/'SourceArt'
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def write(p,data): p.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
meta=read(root/'animations.json')
protected={c['file']:sha(root/c['file']) for c in meta['animations'] if c['id']!='idle'}
protected.update({name:sha(root/name) for name in ['Idle-v3.png','Idle-Animated-v1.png','Idle-Animated-Quiet-v2.png']})
for name in ['animations.json','Validation.json','Browser-Review.json']:
    backup=source/('Before-Still-Idle-'+name)
    if not backup.exists(): shutil.copy2(root/name,backup)
im=Image.open(root/'Idle-Animated-Quiet-v2.png')
held=im.crop((0,0,512,512))
atlas=Image.new('RGBA',(1536,1024),(0,0,0,0))
atlas.paste(held,(0,0))
atlas.save(root/'Idle-Hold-v4.png')
clip=next(c for c in meta['animations'] if c['id']=='idle')
clip.update(file='Idle-Hold-v4.png',frameCount=1,durations=[1000],sourceFrameOrder=[0],description='Single held standing pose: no sway, bobbing, or frame-to-frame movement.',frames=[{'index':0,'sourceIndex':0,'x':0,'y':0,'width':512,'height':512,'pivot':{'x':254.8,'y':254.8}}])
meta['idlePolicy']='Single held pose. Prior animated idle drafts retained for reference.'
write(root/'animations.json',meta)
html=(root/'Actor_Review.html').read_text(encoding='utf-8').replace('href="Idle-Animated-Quiet-v2.png"','href="Idle-Hold-v4.png"').replace('href="Idle-Hold-v3.png"','href="Idle-Hold-v4.png"')
(root/'Actor_Review.html').write_text(html,encoding='utf-8')
validation=read(root/'Validation.json')
check=next(c for c in validation['clips'] if c['clip']=='idle')
check.update(file='Idle-Hold-v4.png',distinctFrames=1,size=[1536,1024],frames=[check['frames'][0]])
validation['frameCount']=sum(c['frameCount'] for c in meta['animations'])
validation['stillIdleRevision']={'heldSource':'Idle-Animated-Quiet-v2.png','sourceRect':[0,0,512,512],'file':'Idle-Hold-v4.png','sha256':sha(root/'Idle-Hold-v4.png'),'sheetSize':[1536,1024],'preservedAssetHashes':protected}
write(root/'Validation.json',validation)
generation=read(root/'Generation.json')
for record in generation['records']:
    if record.get('file')=='Idle-Hold-v3.png': record['status']='superseded-wrong-sheet-size-preserved'
if not any(r.get('file')=='Idle-Hold-v4.png' for r in generation['records']):
    generation['records'].append({'file':'Idle-Hold-v4.png','method':'Whole-frame extraction into the required transparent 1536x1024 atlas; no pixel painting or filters.','source':'Idle-Animated-Quiet-v2.png','sourceRect':[0,0,512,512],'status':'selected-still-idle','reason':'Hold one registered pose in a sheet compatible with the preview loader.'})
write(root/'Generation.json',generation)
recipe=read(source/'Composition.json')
idle=next(c for c in recipe['clips'] if c['clip']=='idle')
idle.update(output='Idle-Hold-v4.png',outputSha256=sha(root/'Idle-Hold-v4.png'),idlePolicy='Single held pose',heldSource='Idle-Animated-Quiet-v2.png',heldSourceSha256=sha(root/'Idle-Animated-Quiet-v2.png'),heldSourceRect=[0,0,512,512],sheetSize=[1536,1024])
write(source/'Composition.json',recipe)
assert all(sha(root/name)==digest for name,digest in protected.items())
for name in ['animations.json','Idle-Hold-v4.png','Actor_Review.html']:
    with urlopen('http://127.0.0.1:9018/Cultures/Russians/Units/EarlyMedieval/HorseArcher/'+name,timeout=10) as response:
        assert response.status==200 and response.read()==(root/name).read_bytes()
review=read(root/'Browser-Review.json')
review['httpChecks']=[{'file':name,'status':200} for name in ['animations.json','Idle-Hold-v4.png','Actor_Review.html']]
review['idleMotionVerified']='Idle references exactly one frame, so cycling cannot produce movement.'
write(root/'Browser-Review.json',review)
print('Idle has exactly one held frame; served files match and other eight clips unchanged.')
