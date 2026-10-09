from PIL import Image,ImageFilter
import numpy as np,json
from pathlib import Path
root=Path(r'C:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/Art/Cultures/Russians/Units/BronzeAge/BronzeAxeman')
report={}
for name in ['Running-BronzeMace-Nadir-v4.png','Charge-BronzeMace-Nadir-v4.png']:
 a=np.array(Image.open(root/name)); frames=[]
 for i in range(6):
  x=i%3*512;y=i//3*512;c=a[y:y+512,x:x+512]; alpha=c[:,:,3]
  yy,xx=np.where(alpha>16)
  solid=Image.fromarray((alpha>128).astype('uint8')*255)
  dil=np.array(solid.filter(ImageFilter.MaxFilter(7)))>0
  outside=alpha[~dil]
  frames.append({'frame':i,'bounds':[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)],'cornerAlpha':int(alpha[:8,:8].max()),'hazeAlphaMaxBeyond3px':int(outside.max()),'hazePixelsAbove16':int((outside>16).sum())})
 report[name]={'size':list(Image.open(root/name).size),'mode':Image.open(root/name).mode,'frames':frames}
print(json.dumps(report,indent=2))
(root/'SourceArt'/'Movement-BronzeMace-Nadir-v4-Checks.json').write_text(json.dumps(report,indent=2))

