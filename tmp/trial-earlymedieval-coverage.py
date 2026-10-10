import json
from pathlib import Path
from PIL import Image,ImageFilter
import numpy as np,importlib.util
root=Path('Art/Cultures/Russians/FactionMasks/EarlyMedieval')
spec=importlib.util.spec_from_file_location('d','scripts/buildRussianBronzeAgeLeatherMasks.py'); d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
man=json.loads((root/'manifest.json').read_text())
for u in man['units']:
 if u['name'] not in ('LightCavalry','Druzhina','HorseArcher'):continue
 for sh in u['sheets']:
  im=Image.open((root/sh['source']).resolve()).convert('RGBA');a=np.asarray(im).astype(np.float32)/255
  h,s,v=d.rgb_to_hsv(a[...,:3]);h=np.where(h>180,h-360,h)
  auto=np.asarray(Image.open(root/'AutoDetected'/sh['mask'].split('?')[0]))[...,3]/255
  near=np.asarray(Image.fromarray(np.uint8(auto*255)).filter(ImageFilter.MaxFilter(21)))/255
  loose=a[...,3]*(1-d.smooth(19,23,h))*d.smooth(-25,-5,h)*d.smooth(.45,.60,s)*d.smooth(.08,.18,v)
  coverage=np.maximum(auto,loose*(near>.5))
  mask=np.dstack([np.full(auto.shape,255,np.uint8)]*3+[np.uint8(np.minimum(coverage,a[...,3])*255)])
  target=Path('tmp/earlymedieval-trial')/sh['mask'].split('?')[0];target.parent.mkdir(parents=True,exist_ok=True);Image.fromarray(mask).save(target)
print('Mounted color expansion trials saved under tmp only')
