from PIL import Image,ImageFilter
import numpy as np,json
from pathlib import Path
root=Path(r'C:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/Art/Cultures/Russians/Units/EarlyModern/MosinNagant');report={}
for name in ['Idle-v2.png','Running-v2.png','Charge-v2.png','Hit-v2.png','Charged-v2.png']:
 im=Image.open(root/name);a=np.array(im);frames=[]
 for i in range(6):
  alpha=a[i//3*512:i//3*512+512,i%3*512:i%3*512+512,3];yy,xx=np.where(alpha>16);dil=np.array(Image.fromarray((alpha>128).astype('uint8')*255).filter(ImageFilter.MaxFilter(7)))>0;outside=alpha[~dil]
  frames.append({'frame':i,'bounds':[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)],'hazeAlphaMaxBeyond3px':int(outside.max()),'hazePixelsAbove16':int((outside>16).sum()),'cornerAlpha':int(alpha[:8,:8].max())})
 report[name]={'size':list(im.size),'mode':im.mode,'frames':frames}
print(json.dumps(report,indent=2));(root/'SourceArt'/'Movement-v2-Checks.json').write_text(json.dumps(report,indent=2))


