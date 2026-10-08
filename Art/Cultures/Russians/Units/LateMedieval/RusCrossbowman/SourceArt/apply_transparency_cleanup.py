"""Register whole extracted pose cells with transparent padding."""
from pathlib import Path
from PIL import Image
import json,hashlib,shutil
ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'SourceArt'
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,d):p.write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
data=read(ROOT/'animations.json');validation=read(ROOT/'Validation.json')
generation=read(SOURCE/'Transparency-Generation.json')
for record in generation['records']:
    if record['status']!='selected-source':continue
    native=SOURCE/record['nativeFile'];im=Image.open(native)
    assert im.mode=='RGBA' and im.size==(1536,1024)
    registered=Image.new('RGBA',im.size)
    for i in range(6):
        x,y=i%3*512,i//3*512
        registered.paste(im.crop((x,y,x+512,y+512)).resize((496,496),Image.Resampling.LANCZOS),(x+8,y+8))
    im=registered
    clip=next(c for c in data['animations'] if c['id']==record['id']);clip['file']=record['file']
    rows=[]
    for i,frame in enumerate(clip['frames']):
        x,y=frame['x'],frame['y'];cell=im.crop((x,y,x+512,y+512));a=cell.getchannel('A')
        guard=max(a.crop(r).getextrema()[1] for r in [(0,0,512,8),(0,504,512,512),(0,0,8,512),(504,0,512,512)])
        assert guard==0,(record['id'],i,guard)
        b=a.point(lambda v:255 if v>16 else 0).getbbox();assert b
        rows.append({'index':i,'visibleBounds':b,'guardAlphaMax':guard,'sha256':hashlib.sha256(cell.tobytes()).hexdigest()})
    assert len({r['sha256'] for r in rows})==6
    im.save(ROOT/record['file'])
    for frame in clip['frames']:
        frame['pivot']={axis:8+value*496/512 for axis,value in frame['pivot'].items()}
    check=next(c for c in validation['clips'] if c['clip']==record['id']);check.update(file=record['file'],frames=rows,sha256=sha(ROOT/record['file']),registration={'source':record['nativeFile'],'size':[496,496],'padding':8},nativePixelsPreserved=False)
write(ROOT/'animations.json',data);write(ROOT/'Validation.json',validation)
history=read(ROOT/'Generation.json');known={r.get('generatedSource') for r in history['records']}
history['records'] += [r for r in generation['records'] if r['generatedSource'] not in known];write(ROOT/'Generation.json',history)
print('ImageGen extraction outputs registered as whole cells with transparent padding.')
