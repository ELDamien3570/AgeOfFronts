from pathlib import Path
import json,cv2,numpy as np
from PIL import Image
root=Path('Art/Cultures/Russians/Units/LateMedieval/HorseArcher');m=json.loads((root/'animations.json').read_text());a=np.array(Image.open(root/m['animations'][0]['file']).convert('RGB'));template=a[95:180,220:295]
for anim in m['animations']:
 im=np.array(Image.open(root/anim['file']).convert('RGB'))
 for index,f in enumerate(anim['frames']):
  frame=im[f['y']:f['y']+512,f['x']:f['x']+512];scores=cv2.matchTemplate(frame,template,cv2.TM_CCOEFF_NORMED);_,score,_,pos=cv2.minMaxLoc(scores)
  print(anim['id'],index,round(score,3),pos)
Image.fromarray(template).save('tmp/saddle-strap-template.png')
