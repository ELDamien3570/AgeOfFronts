from pathlib import Path
import json,cv2,numpy as np
from PIL import Image
root=Path('Art/Cultures/Russians/Units/LateMedieval/HorseArcher');out=Path('Art/Cultures/Russians/FactionMasks/LateMedieval');m=json.loads((root/'animations.json').read_text());a=np.array(Image.open(root/m['animations'][0]['file']).convert('RGB'));template=a[95:180,220:295];strip=np.zeros((85,75),np.uint8);cv2.rectangle(strip,(29,25),(44,72),255,-1)
guide=[]
for anim in m['animations']:
 im=np.array(Image.open(root/anim['file']).convert('RGBA'));target=out/'Corrections/HorseArcher'/(Path(anim['file']).stem+'.correction.png');correction=np.array(Image.open(target).convert('RGBA')) if target.exists() else np.zeros(im.shape,np.uint8)
 for index,f in enumerate(anim['frames']):
  if anim['id']=='charged' and index in (2,3):continue
  frame=im[f['y']:f['y']+512,f['x']:f['x']+512];best=(-1,None)
  cases=[(0,1)] if anim['id'] not in ('death','charged','hit') else [(angle,scale) for angle in range(-100,101,10) for scale in (.8,.9,1.,1.1)]
  for angle,scale in cases:
   mat=cv2.getRotationMatrix2D((37.5,42.5),angle,scale);mat[:,2]+=[30,30]
   patch=cv2.warpAffine(template,mat,(135,145));valid=cv2.warpAffine(np.full((85,75),255,np.uint8),mat,(135,145))
   scores=cv2.matchTemplate(frame[...,:3],patch,cv2.TM_CCORR_NORMED,mask=valid);scores[~np.isfinite(scores)]=-1
   _,score,_,pos=cv2.minMaxLoc(scores)
   if score>best[0]:best=(score,(angle,scale,pos,mat))
  score,(angle,scale,(x,y),mat)=best
  if score<.82:continue
  region=cv2.warpAffine(strip,mat,(135,145))>127; selected=np.zeros((512,512),bool);selected[y:y+145,x:x+135]=region
  hsv=cv2.cvtColor(frame[...,:3],cv2.COLOR_RGB2HSV)
  selected &= (hsv[...,1]>65)&(hsv[...,0]<24)&(frame[...,3]>0)
  sub=correction[f['y']:f['y']+512,f['x']:f['x']+512];sub[selected]=[255,0,0,255]
  guide.append({'animation':anim['id'],'frame':index+1,'score':round(score,3),'pixels':int(selected.sum())})
 target.parent.mkdir(parents=True,exist_ok=True);Image.fromarray(correction).save(target)
(out/'SaddleStrapCorrections.json').write_text(json.dumps({'purpose':'Preserve brown central saddle strap between rear horse armor plates; do not recolor it as red cloth.','registration':'Source-pose template match; reviewed at native coordinates. Occluded or uncertain matches are skipped.','frames':guide},indent=2)+'\n')
print(len(guide),'visible saddle strap guides')
