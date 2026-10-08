from PIL import Image,ImageFilter
import numpy as np,json
from pathlib import Path
root=Path(r'C:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/Art/Cultures/Russians/Units/BronzeAge/BronzeAxeman');name='Charge-BronzeMace-Compact-v5.png';im=Image.open(root/name);a=np.array(im);frames=[]
for i in range(6):
 alpha=a[i//3*512:i//3*512+512,i%3*512:i%3*512+512,3];yy,xx=np.where(alpha>16);dil=np.array(Image.fromarray((alpha>128).astype('uint8')*255).filter(ImageFilter.MaxFilter(7)))>0;outside=alpha[~dil]
 frames.append({'frame':i,'bounds':[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)],'hazeAlphaMaxBeyond3px':int(outside.max()),'hazePixelsAbove16':int((outside>16).sum()),'cornerAlpha':int(alpha[:8,:8].max())})
report={'size':list(im.size),'mode':im.mode,'frames':frames};print(json.dumps(report,indent=2));(root/'SourceArt'/'Charge-BronzeMace-Compact-v5-Checks.json').write_text(json.dumps(report,indent=2))

