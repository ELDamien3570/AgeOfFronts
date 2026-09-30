"""Read-only export validation; compares decoded frame pixels with each sheet cell."""
from pathlib import Path
import hashlib,json,sys
from PIL import Image,ImageSequence
import numpy as np

root=Path(__file__).resolve().parent
manifest=json.loads((root/'Defense-Manifest.json').read_text())
errors=[];count=0;clips=0;assets=[]
def check(condition,message):
    if not condition: errors.append(message)
keys={a['key'] for a in manifest['assets']}
for asset in manifest['assets']:
    folder=(root/asset['directory']).resolve();meta=json.loads((folder/'animations.json').read_text());s=asset['dimension']
    check(s==(1254 if asset['type']=='building' else 314 if asset['type']=='effect' else 627),asset['key']+' dimensions')
    check(meta['camera']=='vertical-overhead-orthographic',asset['key']+' camera declaration')
    check(meta['frameSize']=={'width':s,'height':s},asset['key']+' frameSize')
    for link in meta.get('links',{}).values():
        for key in link if isinstance(link,list) else [link]: check(key in keys,asset['key']+' missing linked asset '+str(key))
    icon=Image.open(folder/'Icon.png');check(icon.size==(s,s) and icon.mode=='RGBA',asset['key']+' icon')
    for name,clip in meta['animations'].items():
        clips+=1;count+=clip['frameCount'];check(len(clip['frames'])==clip['frameCount'],asset['key']+'/'+name+' count')
        check(sum(f['durationMs'] for f in clip['frames'])==clip['durationMs'],asset['key']+'/'+name+' timing')
        sheets={}
        for sheet in clip['sheets']:
            im=Image.open(folder/sheet['file']).convert('RGBA');check(im.size==(sheet['width'],sheet['height']),asset['key']+' sheet size')
            check(max(im.size)<=4096,asset['key']+' texture exceeds4096');sheets[sheet['file']]=im
        final_alpha=None
        for frame in clip['frames']:
            file=folder/frame['file'];check(hashlib.sha256(file.read_bytes()).hexdigest()==frame['sha256'],asset['key']+' hash '+frame['file'])
            im=Image.open(file);check(im.mode=='RGBA' and im.size==(s,s),asset['key']+' frame format '+frame['file'])
            arr=np.asarray(im);alpha=arr[:,:,3];final_alpha=alpha
            check(max(alpha[0].max(),alpha[-1].max(),alpha[:,0].max(),alpha[:,-1].max())==0,asset['key']+' edge alpha '+frame['file'])
            x,y=frame['x'],frame['y'];crop=sheets[frame['sheet']].crop((x,y,x+s,y+s));check(np.array_equal(arr,np.asarray(crop)),asset['key']+' sheet pixels '+frame['file'])
        if asset['type']=='effect':check(final_alpha.max()==0,asset['key']+' final frame must fully vanish')
        for preview,extra in [(clip['preview'],clip['previewPauseMs'])]+([(clip['once'],0)] if clip['once'] else []):
            im=Image.open(folder/preview);check(im.size==(s,s),asset['key']+' preview dimensions');total=0
            for f in ImageSequence.Iterator(im):
                f.load();total+=f.info.get('duration',0)
            check(abs(total-clip['durationMs']-extra)<=4,asset['key']+' preview timing '+preview+':'+str(total))
            check(im.info.get('loop',0)==(0 if preview==clip['preview'] else 1),asset['key']+' preview loop '+preview)
    assets.append({'key':asset['key'],'dimension':s,'clips':len(meta['animations'])})
report={'status':'passed' if not errors else 'failed','assets':len(assets),'clips':clips,'frames':count,'checks':['exact RGBA sizes','transparent boundaries','PNG hashes','lossless sheet cell equality','4096 texture bounds','preview durations and loops','effect terminal alpha','asset links'],'errors':errors,'assetSummary':assets}
(root/'Defense-Validation.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
sys.exit(bool(errors))
