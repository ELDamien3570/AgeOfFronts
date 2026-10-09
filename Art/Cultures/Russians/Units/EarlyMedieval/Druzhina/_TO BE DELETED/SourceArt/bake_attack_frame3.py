"""Replace only the corrected whole third pose; preserve the other five poses exactly."""
from pathlib import Path
from PIL import Image
import hashlib, json, shutil

source=Path(__file__).resolve().parent
root=source.parent
def read(p): return json.loads(p.read_text(encoding='utf-8'))
def write(p,v): p.write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()

record_path=source/'Generation-attack-v3.json'
record=read(record_path)
raw=Path(record.get('generatedEditSource',record['generatedSource']))
shutil.copy2(raw,source/'Generated-Attack-v3.png')
edited=Image.open(raw)
assert edited.mode=='RGBA' and edited.size==(1536,1024)
recipe_path=source/'Composition.json'
recipe=read(recipe_path)
track=next(c for c in recipe['clips'] if c['clip']=='attack')
placement=track['framePlacements'][2]
rect=placement['sourceRect']
# The generated sixth pose begins slightly above the old gutter. Select the
# nearest truly empty row so no neighboring pose enters the third cell.
edited_alpha=edited.getchannel('A')
empty_rows=[y for y in range(rect[3]-30,rect[3]) if edited_alpha.crop((rect[0],y,rect[2],y+1)).getextrema()[1]==0]
assert empty_rows,'Correction has no transparent row gutter'
last_row=max(empty_rows)
cell=Image.new('RGBA',(512,rect[3]-rect[1]),(0,0,0,0))
cell.paste(edited.crop((rect[0],rect[1],rect[2],last_row+1)),(0,0))
native=Image.open(source/'Native-Attack-v2.png').copy()
native.paste(cell,(rect[0],rect[1]))
native_path=source/'Native-Attack-v3.png'
native.save(native_path)
before=Image.open(root/'Attack-v2.png')
out=before.copy()
frame=Image.new('RGBA',(512,512),(0,0,0,0))
scaled=cell.resize((round(cell.width*.8),round(cell.height*.8)),Image.Resampling.LANCZOS)
frame.paste(scaled,tuple(placement['destinationOffset']))
alpha=frame.getchannel('A')
assert max(alpha.crop(r).getextrema()[1] for r in [(0,0,512,8),(0,504,512,512),(0,0,8,512),(504,0,512,512)])==0
out.paste(frame,(1024,0))
for i in [0,1,3,4,5]:
    x,y=(i%3)*512,(i//3)*512
    assert out.crop((x,y,x+512,y+512)).tobytes()==before.crop((x,y,x+512,y+512)).tobytes()
out.save(root/'Attack-v3.png')
for name in ['animations.json','Validation.json','Generation.json']:
    backup=source/('Before-Attack-Frame3-'+name)
    if not backup.exists(): shutil.copy2(root/name,backup)
metadata=read(root/'animations.json')
clip=next(c for c in metadata['animations'] if c['id']=='attack')
clip['file']='Attack-v3.png'
write(root/'animations.json',metadata)
validation=read(root/'Validation.json')
check=next(c for c in validation['clips'] if c['clip']=='attack')
check['file']='Attack-v3.png'
check['unchangedFrames']=[0,1,3,4,5]
bounds=alpha.point(lambda v:255 if v>16 else 0).getbbox()
rootpivot=50+256*.8
preview=[256+(v-rootpivot)*(400/512*1.25) for v in bounds]
assert min(preview)>=0 and max(preview)<=512
check['frames'][2].update({'sourceVisibleBounds':cell.getchannel('A').point(lambda v:255 if v>16 else 0).getbbox(),'visibleBounds':bounds,'guardAlphaMax':0,'registeredPreviewBounds':preview,'sha256':hashlib.sha256(frame.tobytes()).hexdigest()})
assert len({f['sha256'] for f in check['frames']})==6
write(root/'Validation.json',validation)
track.update({'source':'SourceArt/Native-Attack-v3.png','sourceSha256':sha(native_path),'output':'Attack-v3.png','outputSha256':sha(root/'Attack-v3.png'),'correctedFrames':[2],'unchangedFrames':[0,1,3,4,5]})
write(recipe_path,recipe)
record.update({'generatedEditSource':str(raw),'generatedSource':str(native_path),'nativeCopy':'SourceArt/Native-Attack-v3.png','editSourceRect':[rect[0],rect[1],rect[2],last_row+1],'assembly':'Replace only source frame 3 with generated whole pose and transparent gutter padding; retain other five original poses pixel-for-pixel.'})
write(record_path,record)
generation=read(root/'Generation.json')
if not any(r.get('file')=='Attack-v3.png' for r in generation['records']): generation['records'].append(record)
write(root/'Generation.json',generation)
plan=read(source/'Animation-Plan.json')
next(j for j in plan['jobs'] if j['id']=='attack')['file']='Attack-v3.png'
write(source/'Animation-Plan.json',plan)
print('Frame 3 replaced; other five attack frames identical; padding and preview bounds pass.')
