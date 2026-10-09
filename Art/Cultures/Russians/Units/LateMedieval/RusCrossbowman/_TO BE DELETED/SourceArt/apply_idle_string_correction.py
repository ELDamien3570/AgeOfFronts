"""Register the corrected single idle without replacing other animation clips."""
from pathlib import Path
from PIL import Image
import hashlib,json,shutil
ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'SourceArt'
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,d):p.write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
data=read(ROOT/'animations.json')
other={c['file']:sha(ROOT/c['file']) for c in data['animations'] if c['id']!='idle'}
backup=SOURCE/'Before-String-Correction-animations.json'
if not backup.exists():shutil.copy2(ROOT/'animations.json',backup)
record=read(SOURCE/'String-Correction.json')['records'][-1]
native=Image.open(SOURCE/record['nativeFile'])
assert native.mode=='RGBA'
im=Image.new('RGBA',(native.width+48,native.height+48));im.paste(native,(24,24))
out=ROOT/record['file'];im.save(out)
w,h=im.size;a=im.getchannel('A');assert a.getbbox()
guard=max(a.crop(r).getextrema()[1] for r in [(0,0,w,8),(0,h-8,w,h),(0,0,8,h),(w-8,0,w,h)])
assert guard==0
clip=next(c for c in data['animations'] if c['id']=='idle')
clip.update(file=record['file'],frameCount=1,durations=[1000],description='Corrected single idle: one visible string above the stock, hands clear of its path. Pending design review.',frames=[{'index':0,'x':0,'y':0,'width':w,'height':h,'pivot':{'x':w/2,'y':h/2}}])
data['idleDesignStatus']='Corrected string position pending user review; other clips retain earlier geometry.'
write(ROOT/'animations.json',data)
assert all(sha(ROOT/f)==v for f,v in other.items())
validation=read(ROOT/'Validation.json')
validation['clips']=[c for c in validation['clips'] if c['clip']!='idle']
validation['clips'].insert(0,{'clip':'idle','file':record['file'],'distinctFrames':1,'size':[w,h],'guardAlphaMax':guard,'sha256':sha(out),'nativePixelsPreserved':True})
validation.update(frameCount=sum(c['frameCount'] for c in data['animations']),idleStringCorrection='Pending user review',otherAnimationSheetsUnchanged=True)
write(ROOT/'Validation.json',validation)
history=read(ROOT/'Generation.json');known={r.get('generatedSource') for r in history['records']}
history['records'] += [r for r in read(SOURCE/'String-Correction.json')['records'] if r['generatedSource'] not in known]
write(ROOT/'Generation.json',history)
print('Corrected single idle registered; nine other sheets unchanged; alpha guards clear.')
