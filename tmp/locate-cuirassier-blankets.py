from pathlib import Path
import json,cv2,numpy as np
from PIL import Image
root=Path('Art/Cultures/Russians/Units/EarlyModern/Cuirassier');m=json.loads((root/'animations.json').read_text());im=np.asarray(Image.open(root/m['animations'][0]['file']).convert('RGB'));template=im[153:190,199:311];guides=[]
for anim in m['animations']:
 im=np.asarray(Image.open(root/anim['file']).convert('RGB'))
 for index,f in enumerate(anim['frames']):
  frame=im[f['y']:f['y']+512,f['x']:f['x']+512];best=(-1,None)
  cases=[(0,1)] if anim['id'] not in ('death','death-thrown','hit','charged') else [(angle,scale) for angle in range(-180,181,15) for scale in (.8,.9,1.,1.1)]
  for angle,scale in cases:
   mat=cv2.getRotationMatrix2D((56,18.5),angle,scale);mat[:,2]+=[34,71.5]
   patch=cv2.warpAffine(template,mat,(180,180));valid=cv2.warpAffine(np.full((37,112),255,np.uint8),mat,(180,180))
   scores=cv2.matchTemplate(frame,patch,cv2.TM_CCOEFF_NORMED,mask=valid);scores[~np.isfinite(scores)]=-1
   _,score,_,pos=cv2.minMaxLoc(scores)
   if score>best[0]:best=(score,(angle,scale,pos,mat.tolist()))
  guides.append({'animation':anim['id'],'frame':index,'score':round(best[0],3),'transform':best[1]})
  print(anim['id'],index,round(best[0],3),best[1][:3])
Path('tmp/cuirassier-blanket-matches.json').write_text(json.dumps(guides,indent=2));Image.fromarray(template).save('tmp/cuirassier-blanket-template.png')
