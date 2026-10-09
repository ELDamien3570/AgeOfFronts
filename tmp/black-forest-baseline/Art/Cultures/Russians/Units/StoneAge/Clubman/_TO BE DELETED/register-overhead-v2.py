"""Register overhead clubman sheets and preserve the previous review sources.
This inspects artwork and updates metadata; generated image pixels stay unchanged.
"""
from pathlib import Path
from collections import deque
from PIL import Image
import numpy as np
import json, shutil, hashlib, statistics
ROOT = Path(__file__).resolve().parent
BACKUP = ROOT / 'SourceArt' / 'Before-Overhead-v2'

def preserve(path):
    dest = BACKUP / path.relative_to(ROOT)
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dest)

def crown_center(frame):
    pixels = np.asarray(frame).astype(np.int16)
    r,g,b,a = [pixels[:,:,i] for i in range(4)]
    mask = (r>70)&(r>g*1.5)&(r>b*1.5)&(a>128)
    visited = np.zeros(mask.shape, dtype=bool)
    components=[]
    for sy,sx in zip(*np.nonzero(mask)):
        if visited[sy,sx]: continue
        queue=deque([(sy,sx)]); visited[sy,sx]=True; points=[]
        while queue:
            y,x=queue.popleft(); points.append((y,x))
            for ny,nx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
                if 0<=ny<512 and 0<=nx<512 and mask[ny,nx] and not visited[ny,nx]:
                    visited[ny,nx]=True; queue.append((ny,nx))
        if len(points)>700:
            ys,xs=zip(*points); cx=(min(xs)+max(xs))/2; cy=(min(ys)+max(ys))/2
            if 140<cx<380 and 80<cy<360 and 40<max(xs)-min(xs)<180:
                components.append((len(points),cx,cy,max(xs)-min(xs)+1))
    if not components: raise ValueError('No isolated red cap found')
    _,cx,cy,width=max(components)
    return round(cx),round(cy),int(width)

if __name__ == '__main__':
    records=[]
    for n in (1,2,3):
        records.extend(json.loads((ROOT/'SourceArt'/f'Overhead-v2-Batch{n}.json').read_text(encoding='utf-8-sig')))
    main_path=ROOT/'animations.json'; preserve(main_path)
    main=json.loads(main_path.read_text(encoding='utf-8'))
    supplemental=json.loads((ROOT/'Formation'/'SourceActor'/'animations.json').read_text(encoding='utf-8'))
    clips={c['id']:c for c in main['animations']+supplemental['animations']}
    registration=[]
    for record in records:
        clip=clips[record['id']]; clip['file']=record['file']; clip['scale']=1
        clip['sha256']=hashlib.sha256((ROOT/record['file']).read_bytes()).hexdigest()
        image=Image.open(ROOT/record['file'])
        assert image.size==(1536,1024) and image.mode=='RGBA', (record['id'],image.size,image.mode)
        points=[]
        for frame in clip['frames']:
            if record['id'].startswith('death'):
                frame['pivot']={'x':256,'y':256}
            else:
                crop=image.crop((frame['x'],frame['y'],frame['x']+512,frame['y']+512))
                x,y,width=crown_center(crop)
                frame['pivot']={'x':x,'y':y+20}
                points.append({'frame':frame['index'],'crownCenter':[x,y],'crownWidth':width})
        clip['scale'] = round(110 / (statistics.median(p['crownWidth'] for p in points) if points else crown_center(image.crop((0,0,512,512)))[2]), 5)
        registration.append({'id':record['id'],'anchors':points,'note':'Fixed authored crown/chest anchors; death uses ground root at cell center.'})
        clip.setdefault('description',record['id'].replace('-',' ').capitalize()+'.')
    main['animations']=[clips[r['id']] for r in records]
    main['artRevision']='overhead-v2'
    main['camera']='strict-90-degree-vertical-overhead-orthographic'
    main['registration']='Authored crown/chest pivots measured once from generated cells; fixed scale per clip, no runtime fitting. Death root remains at cell center.'
    main['integrationStatus']='Overhead v2 art review, including charge strike and both deaths; formation atlases rebuilt from these sources.'
    (ROOT/'SourceArt'/'Overhead-v2-Registration.json').write_text(json.dumps(registration,indent=2)+'\n')
    main_path.write_text(json.dumps(main,indent=2)+'\n')
    generation_path=ROOT/'Generation.json'; preserve(generation_path)
    generation=json.loads((BACKUP/'Generation.json').read_text(encoding='utf-8'))
    fixes=json.loads((ROOT/'SourceArt'/'Overhead-v2-Spacing-Corrections.json').read_text(encoding='utf-8-sig'))
    fixed_ids={r['id'] for r in fixes}
    generation['records'].extend({'id':r['id']+'-overhead-v2','created':'2026-10-07','tool':'built-in image_gen','reference':'SourceArt/Overhead-Master-v2.png','file':('SourceArt/'+r['file'].replace('.png','-spacing-draft.png') if r['id'] in fixed_ids else r['file']),'source':r['source'],'prompt':r['prompt']} for r in records)
    generation['records'].extend({'id':r['id']+'-overhead-v2-spacing','created':'2026-10-07','tool':'built-in image_gen','reference':'SourceArt/'+r['file'].replace('.png','-spacing-draft.png'),'file':r['file'],'source':r['source'],'prompt':r['prompt']} for r in fixes)
    generation_path.write_text(json.dumps(generation,indent=2)+'\n')
    formation=ROOT/'Formation'
    for path in formation.glob('*'):
        if path.is_file() and (path.suffix=='.png' or path.name in ('animations.json','formation.json','Validation.json','Browser-Review.json')): preserve(path)
    path=formation/'formation.json'; definition=json.loads(path.read_text(encoding='utf-8')); definition['actorSources']=['../animations.json']; path.write_text(json.dumps(definition,indent=2)+'\n')
    html_path=ROOT/'Actor_Review.html'; preserve(html_path)
    html=html_path.read_text(encoding='utf-8').replace('One clubman. Seven motions.','One clubman. Nine overhead motions.').replace('Loading seven sprite sheets','Loading nine sprite sheets').replace('Single actor prototype','Overhead v2 review')
    html_path.write_text(html,encoding='utf-8')
    print(json.dumps({'clips':len(main['animations']),'registration':registration}))



