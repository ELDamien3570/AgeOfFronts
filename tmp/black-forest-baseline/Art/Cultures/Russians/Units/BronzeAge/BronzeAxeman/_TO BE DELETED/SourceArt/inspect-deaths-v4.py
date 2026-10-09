from PIL import Image, ImageFilter
from pathlib import Path
import numpy as np,json
p=Path(__file__).resolve().parent.parent
for name in ['Death-BronzeMace-Nadir-v4','Death-Back-BronzeMace-Nadir-v4']:
 f=p/(name+'.png')
 if not f.exists(): continue
 im=Image.open(f).convert('RGBA')
 checks=[]
 for i in range(6):
  c=im.crop(((i%3)*512,(i//3)*512,(i%3+1)*512,(i//3+1)*512))
  a=np.array(c)[:,:,3]; y,x=np.where(a>16)
  opaque=Image.fromarray(((a>200)*255).astype('uint8')).filter(ImageFilter.MaxFilter(7)); far=np.array(opaque)==0
  checks.append({'frame':i,'bounds':[int(x.min()),int(y.min()),int(x.max()),int(y.max())],'pixelsOver16FarFromOpaque':int(np.sum((a>16)&far)), 'farAlphaMax':int(a[far].max())})
 crop=im.crop((1024,512,1536,1024)); corpse='Corpse-Back-BronzeMace-v4.png' if 'Back' in name else 'Corpse-Prone-BronzeMace-v4.png';crop.save(p/corpse)
 print(json.dumps({'file':f.name,'size':im.size,'checks':checks}))
