from PIL import Image
import numpy as np,json
from pathlib import Path
root=Path('Art/Cultures/Russians/Units/Modern/Tunguska')
d=json.loads((root/'animations.json').read_text())
out={}
for c in d['animations']:
 a=np.array(Image.open(root/c['file']));measures=[]
 for i in range(6):
  t=a[i//3*512:i//3*512+512,i%3*512:i%3*512+512].astype(float)
  r,g,b,alpha=[t[:,:,j] for j in range(4)]
  m=(alpha>128)&(b>r*1.05)&(b>g*.98)&(b<170)
  # Select the long track strips, excluding blue gun barrels.
  col=m.sum(axis=0);xs=np.where(col>col.max()*.60)[0]
  lo,hi=int(xs.min()),int(xs.max())
  edge=m.copy();edge[:,lo+30:hi-30]=False
  counts=edge.sum(axis=1);ys=np.where(counts>max(3,counts.max()*.3))[0]
  bounds=[lo,int(ys.min()),hi+1,int(ys.max()+1)]
  measures.append(bounds)
 out[c['id']]=measures
print(json.dumps(out,indent=2))
(root/'SourceArt'/'Hull-Measurements-v4.json').write_text(json.dumps(out,indent=2))

