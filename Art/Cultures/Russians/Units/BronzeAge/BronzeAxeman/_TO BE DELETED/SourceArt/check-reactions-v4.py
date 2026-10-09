from PIL import Image,ImageFilter
import numpy as np,json
from pathlib import Path
from collections import deque
root=Path(r'C:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/Art/Cultures/Russians/Units/BronzeAge/BronzeAxeman');report={}
for name in ['Hit-BronzeMace-Nadir-v4.png','Charged-BronzeMace-Nadir-v4.png']:
 a=np.array(Image.open(root/name));frames=[]
 for i in range(6):
  c=a[i//3*512:i//3*512+512,i%3*512:i%3*512+512];alpha=c[:,:,3]
  yy,xx=np.where(alpha>16);solid=Image.fromarray((alpha>128).astype('uint8')*255);dil=np.array(solid.filter(ImageFilter.MaxFilter(7)))>0
  outside=alpha[~dil]
  frame={'frame':i,'bounds':[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)],'hazeAlphaMaxBeyond3px':int(outside.max()),'hazePixelsAbove16':int((outside>16).sum())}
  if name.startswith('Charged') and i==1:
   mask=alpha>128;seen=np.zeros_like(mask); comps=[]
   for cy,cx in zip(*np.where(mask)):
    if seen[cy,cx]:continue
    todo=[(int(cy),int(cx))];seen[cy,cx]=True;points=[]
    while todo:
     y,x=todo.pop();points.append((y,x))
     for dy,dx in [(0,1),(1,0),(0,-1),(-1,0)]:
      ny,nx=y+dy,x+dx
      if 0<=ny<512 and 0<=nx<512 and mask[ny,nx] and not seen[ny,nx]:
       seen[ny,nx]=True;todo.append((ny,nx))
    if len(points)>10:
     pts=np.array(points);comps.append({'pixels':len(points),'bounds':[int(pts[:,1].min()),int(pts[:,0].min()),int(pts[:,1].max()+1),int(pts[:,0].max()+1)]})
   frame['opaqueComponents']=sorted(comps,key=lambda z:-z['pixels'])
  frames.append(frame)
 report[name]={'size':list(Image.open(root/name).size),'mode':Image.open(root/name).mode,'frames':frames}
print(json.dumps(report,indent=2));(root/'SourceArt'/'Reactions-BronzeMace-Nadir-v4-Checks.json').write_text(json.dumps(report,indent=2))

