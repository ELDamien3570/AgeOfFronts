"""Replace only attack cells 3/4; preserve the other cells and approved charge."""
from pathlib import Path
from PIL import Image
import json, hashlib, shutil

root = Path(__file__).resolve().parent.parent
sources = root / 'SourceArt'
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def write(path, data): path.write_text(json.dumps(data, indent=2)+'\n',encoding='utf-8')
old = Image.open(root/'Attack-v1.png').convert('RGBA')
atlas_path = sources/'Thrust-Grip-Atlas-Native-v2.png'
frame_path = sources/'Thrust-Grip-Frame4-Native-v2.png'
atlas = Image.open(atlas_path).convert('RGBA')
frame = Image.open(frame_path).convert('RGBA')
assert atlas.size == old.size
charge_hash = sha(root/'Charge-Attack-v1.png')
new = old.copy()
# Discard the generator's empty edge padding, retaining the entire pose at native cell coordinates.
new.paste(Image.new('RGBA',(512,512)),(1024,0))
new.paste(atlas.crop((1032,8,1528,504)),(1032,8))
# The single-frame generation is a larger square. Normalize the whole canvas, not silhouette bounds.
new.paste(frame.resize((512,512),Image.Resampling.LANCZOS),(0,512))
checks = []
for i in range(6):
    rect = ((i%3)*512,(i//3)*512,(i%3+1)*512,(i//3+1)*512)
    cell = new.crop(rect)
    if i not in [2,3]: assert cell.tobytes() == old.crop(rect).tobytes()
    alpha = cell.getchannel('A')
    guard = max(alpha.crop(r).getextrema()[1] for r in [(0,0,512,8),(0,504,512,512),(0,0,8,512),(504,0,512,512)])
    assert guard==0,(i,guard)
    bounds=alpha.point(lambda x:255 if x>16 else 0).getbbox()
    l,t,r,b=bounds
    preview=[256+(l-254.8)*400/512,256+(t-274)*400/512,256+(r-254.8)*400/512,256+(b-274)*400/512]
    assert min(preview)>=0 and max(preview)<=512
    checks.append({'frame':i,'visibleBounds':bounds,'guardAlphaMax':guard,'registeredPreviewBounds':preview,'sha256':hashlib.sha256(cell.tobytes()).hexdigest(),'unchanged':i not in [2,3]})
new.save(root/'Attack-Overhand-v2.png')
for file in ['animations.json','Validation.json','Browser-Review.json']:
    backup=sources/('Thrust-Grip-Before-'+file)
    if not backup.exists():shutil.copy2(root/file,backup)
data=json.loads((root/'animations.json').read_text())
clip=next(c for c in data['animations'] if c['id']=='attack')
clip['file']='Attack-Overhand-v2.png'
clip['description']='Raised overhand rear grip through draw-back, forward spear thrust, and recovery.'
write(root/'animations.json',data)
validation=json.loads((root/'Validation.json').read_text())
entry=next(c for c in validation['clips'] if c['clip']=='attack')
entry.update({'file':clip['file'],'frames':checks,'distinctFrames':len(set(c['sha256'] for c in checks))})
validation['mainAttackGripCorrection']={'revisedFrames':[3,4],'preservedFrames':[1,2,5,6],'chargeAttackUnchanged':sha(root/'Charge-Attack-v1.png')==charge_hash,'visualApproval':'Pending user review.'}
write(root/'Validation.json',validation)
write(sources/'Thrust-Grip-Bake.json',{'date':'2026-10-07','output':clip['file'],'outputSha256':sha(root/clip['file']),'base':'Attack-v1.png','baseSha256':sha(root/'Attack-v1.png'),'frame3':{'source':atlas_path.name,'sha256':sha(atlas_path),'rect':[1032,8,1528,504],'destination':[1032,8]},'frame4':{'source':frame_path.name,'sha256':sha(frame_path),'wholeCanvasSourceSize':frame.size,'wholeCanvasDestinationSize':[512,512],'destination':[0,512]},'chargeSha256':charge_hash,'preservedFrameIndices':[0,1,4,5],'checks':checks})
print('Only main attack frames 3/4 replaced; other cells, timings, pivots and charge preserved. All guards and preview bounds pass.')
