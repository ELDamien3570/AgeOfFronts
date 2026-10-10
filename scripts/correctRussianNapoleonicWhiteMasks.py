"""Exclude cream blanket and small highlight fragments from Napoleonic white uniform masks."""
from pathlib import Path
import json,cv2,numpy as np
from PIL import Image
REPO=Path(__file__).resolve().parents[1]
OUT=REPO/'Art/Cultures/Russians/FactionMasks/Napoleonic'
man=json.loads((OUT/'manifest.json').read_text());unit=next(u for u in man['units'] if u['name']=='Cuirassier');report=[]
for sh in unit['sheets']:
 target=sh['mask'].split('?')[0];auto=np.asarray(Image.open(OUT/'AutoDetected'/target))[...,3];source=np.asarray(Image.open((OUT/sh['source']).resolve()).convert('RGBA'));hsv=cv2.cvtColor(source[...,:3],cv2.COLOR_RGB2HSV)
 n,labels,stats,_=cv2.connectedComponentsWithStats(np.uint8(auto>12));erase=np.zeros(auto.shape,bool)
 for i in range(1,n):
  region=labels==i;core=region&(auto>64);area=int(core.sum())
  saturation=float(hsv[...,1][core].mean()) if area else 255
  if area<100 or saturation>33:
   erase|=region;report.append({'sheet':sh['file'],'bounds':stats[i,:4].tolist(),'corePixels':area,'meanSaturation':round(saturation,2),'reason':'small isolated highlight' if area<100 else 'cream blanket material'})
 dest=OUT/'Corrections'/target.replace('.faction-mask.png','.correction.png');corr=np.asarray(Image.open(dest).convert('RGBA')).copy() if dest.exists() else np.zeros(source.shape,np.uint8)
 corr[erase]=[255,0,0,255];dest.parent.mkdir(parents=True,exist_ok=True);Image.fromarray(corr).save(dest)
(OUT/'CuirassierMaterialExclusions.json').write_text(json.dumps({'purpose':'Keep the cream blanket roll and small hoof/metal highlights at their original color. Broad neutral white uniform cloth remains selected.','components':report},indent=2)+'\n')
print(len(report),'excluded material/highlight fragments')
