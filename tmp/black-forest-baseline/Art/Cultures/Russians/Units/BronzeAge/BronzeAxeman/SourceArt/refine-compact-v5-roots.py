from pathlib import Path
import json
from PIL import Image
import numpy as np
root=Path('Art/Cultures/Russians/Units/BronzeAge/BronzeAxeman')
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
p=root/'animations.json';d=read(p)
clip=next(c for c in d['animations'] if c['id']=='charge-attack')
img=np.array(Image.open(root/clip['file']))
changes=[]
for i in [3,4]:
 alpha=img[512:1024,i%3*512:i%3*512+512,3];yy,xx=np.where(alpha>16)
 old=dict(clip['frames'][i]['pivot'])
 minimumY=float(yy.max()+1)-248/(420/512*clip['scale'])
 clip['frames'][i]['pivot']['y']=round(max(old['y'],minimumY),2)
 changes.append({'frame':i,'before':old,'after':clip['frames'][i]['pivot']})
p.write_text(json.dumps(d,indent=2),encoding='utf-8')
p=root/'SourceArt'/'Strikes-BronzeMace-Compact-v5-Registration.json';r=read(p)
r['charge-attack']['pivots']=[f['pivot'] for f in clip['frames']]
r['charge-attack']['previewRootAdjustments']=changes
p.write_text(json.dumps(r,indent=2),encoding='utf-8')
print(json.dumps(changes))

