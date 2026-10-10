from pathlib import Path
import json,cv2,numpy as np
from PIL import Image
root=Path('Art/Cultures/Russians/Units/LateMedieval/HorseArcher');m=json.loads((root/'animations.json').read_text());a=np.array(Image.open(root/m['animations'][0]['file']).convert('RGB'));template=a[95:180,220:295]
for anim in m['animations']:
 im=np.array(Image.open(root/anim['file']).convert('RGB'))
 for index,f in enumerate(anim['frames']):
  frame=im[f['y']:f['y']+512,f['x']:f['x']+512];best=(-1,None)
  cases=[(0,1)] if anim['id'] not in ('death','charged','hit') else [(angle,scale) for angle in range(-100,101,10) for scale in (.8,.9,1.,1.1)]
  for angle,scale in cases:
   mat=cv2.getRotationMatrix2D((37.5,42.5),angle,scale);mat[:,2]+=[30,30]
   patch=cv2.warpAffine(template,mat,(135,145)); valid=cv2.warpAffine(np.full((85,75),255,np.uint8),mat,(135,145))
   scores=cv2.matchTemplate(frame,patch,cv2.TM_CCORR_NORMED,mask=valid);scores[~np.isfinite(scores)]=-1
   _,score,_,pos=cv2.minMaxLoc(scores)
   if score>best[0]:best=(score,(angle,scale,pos,mat.tolist()))
  print(anim['id'],index,round(best[0],3),best[1][:3])
