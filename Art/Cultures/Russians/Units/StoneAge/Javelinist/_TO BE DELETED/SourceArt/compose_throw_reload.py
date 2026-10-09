"""Bake whole authored poses; preserve unrelated single-unit assets."""
from pathlib import Path
from PIL import Image
import json, hashlib, shutil
ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'SourceArt'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,d): p.write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
for name in ['animations.json','Validation.json','Browser-Review.json']:
    backup=SOURCE/('Before-Throw-Reload-'+name)
    if not backup.exists(): shutil.copy2(ROOT/name,backup)
data=json.loads((SOURCE/'Before-Throw-Reload-animations.json').read_text())
preserved={c['file']:sha(ROOT/c['file']) for c in data['animations'] if c['id'] not in ['attack','charge-attack']}
records=json.loads((SOURCE/'Throw-Reload-Generation.json').read_text())['records']
# Authored torso roots from inspected cap centers plus the consistent body offset.
roots={'attack': [(280.13, 269.65), (249.76, 323.33), (238.11, 326.5), (282.13, 280.25), (229.63, 284.37), (248.58, 252.82)], 'charge-attack': [(272.48, 287.9), (237.05, 305.91), (252.23, 318.26), (288.72, 311.44), (280.48, 308.26), (248.58, 278.01)], 'reload': [(281.31, 259.77), (277.19, 293.43), (241.88, 304.02), (296.14, 258.0), (273.3, 262.24), (260.12, 261.65)]}
recipes=[]
for record in records:
    if record['status']!='selected-source': continue
    ident=record['clip']; native=SOURCE/record['nativeFile']
    im=Image.open(native).convert('RGBA'); assert im.size==(1536,1024)
    sheet=Image.new('RGBA',im.size); tracks=[]
    for i in range(6):
        x,y=i%3*512,i//3*512; rect=(x,y,x+512,y+512)
        pose=im.crop(rect).resize((435,435),Image.Resampling.LANCZOS)
        sheet.paste(pose,(x+38,y+38))
        tracks.append({'index':i,'sourceRect':rect,'offset':[38,38],'destinationSize':[435,435],'authoredNativeRoot':roots[ident][i]})
    sheet.save(ROOT/record['file'])
    clip=next((c for c in data['animations'] if c['id']==ident),None)
    if clip is None:
        clip={'id':ident,'label':'Reload','loop':False,'scale':1.06,'durations':[120,180,180,200,180,220],'frameCount':6,'fps':6}
        data['animations'].insert(next(i for i,c in enumerate(data['animations']) if c['id']=='attack')+1,clip)
    clip['file']=record['file']
    clip['frames']=[{'index':i,'x':i%3*512,'y':i//3*512,'width':512,'height':512,'pivot':{'x':round(38+roots[ident][i][0]*435/512,2),'y':round(38+roots[ident][i][1]*435/512,2)}} for i in range(6)]
    if ident=='reload':
        clip['description']='Reach behind the shoulder, grip a spare shaft, extract one javelin, bring it around, and lower it to armed ready.'
        clip['weaponState']={'start':'unarmed','end':'armed'}
    else:
        clip['description']=('Plant and turn into an overarm throw' if ident=='attack' else 'Brake the advance, plant, and make a forceful overarm throw')+', release, follow through, and settle unarmed. Reload is a separate clip.'
        clip['weaponState']={'start':'armed','end':'unarmed'}
    recipes.append({'clip':ident,'source':record['nativeFile'],'sourceSha256':sha(native),'output':record['file'],'outputSha256':sha(ROOT/record['file']),'tracks':tracks})
data['integrationStatus']='Single-soldier art review; runtime formation instancing and combat integration are separate.'
data['throwReloadContract']={'sequence':['attack','reload','idle'],'chargeSequence':['charge-attack','reload','idle'],'releaseFrame':3,'timingAuthority':'Runtime controls attack and reload timing. Source clips do not create projectiles or consume ammunition.'}
write(ROOT/'animations.json',data)
assert all(sha(ROOT/f)==h for f,h in preserved.items())
write(SOURCE/'Throw-Reload-Bake.json',{'method':'Uniform whole-cell scale and padding; authored torso pivots, no pose painting or alpha filtering.','clips':recipes,'preservedHashes':preserved})
history=json.loads((ROOT/'Generation.json').read_text()); known={r.get('generatedSource') for r in history['records']}
history['records'] += [r for r in records if r['generatedSource'] not in known]
history['throwReloadRevision']='Selected motion sources and prompts: SourceArt/Throw-Reload-Generation.json; recipe: SourceArt/Throw-Reload-Bake.json.'
write(ROOT/'Generation.json',history)
print('Selected revised attack, charge attack and reload; other six sheets preserved.')
