"""Author local Classical Age garment corrections without editing any earlier age."""
from collections import deque
from pathlib import Path
import importlib.util
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path('Art/Cultures/Russians')
OUT = ROOT / 'FactionMasks/ClassicalAge'
spec=importlib.util.spec_from_file_location('material', 'scripts/buildRussianBronzeAgeLeatherMasks.py')
material=importlib.util.module_from_spec(spec);spec.loader.exec_module(material)

def blobs(mask):
    seen=np.zeros(mask.shape,bool); h,w=mask.shape; found=[]
    for sy,sx in zip(*np.nonzero(mask)):
        if seen[sy,sx]: continue
        q=deque([(int(sy),int(sx))]);seen[sy,sx]=True;points=[]
        while q:
            y,x=q.popleft();points.append((y,x))
            for dy,dx in ((-1,0),(1,0),(0,-1),(0,1)):
                yy,xx=y+dy,x+dx
                if 0<=yy<h and 0<=xx<w and mask[yy,xx] and not seen[yy,xx]:
                    seen[yy,xx]=True;q.append((yy,xx))
        if len(points)>400:found.append(points)
    return sorted(found,key=len,reverse=True)

man=json.loads((OUT/'manifest.json').read_text())
for unit in man['units']:
    for sheet in unit['sheets']:
        name=unit['name']; filename=sheet['file']
        mounted=name in ('LightCavalry','HorseArcher') and 'Death-Thrown' in filename
        archer=name=='RecurveArcher' and filename in ('death-v1.png','death-back-v1.png')
        # Find exact authored death file names from the selected metadata.
        meta=json.loads((OUT/unit['metadata']).resolve().read_text())
        relevant=next((a for a in meta['animations'] if a['file']==filename and a['id'] in ('death','death-back')),None)
        archer=name=='RecurveArcher' and relevant is not None
        if not mounted and not archer:continue
        image=Image.open((OUT/sheet['source']).resolve()).convert('RGBA');pixels=np.asarray(image)
        h,s,v=material.rgb_to_hsv(pixels[...,:3].astype(np.float32)/255)
        h=np.where(h>180,h-360,h)
        skin=material.smooth(10,13,h)*(1-material.smooth(23,27,h))*material.smooth(.60,.70,v)*(1-material.smooth(.60,.70,s))
        loose=(1-material.smooth(21,24,h))*material.smooth(.50,.65,s)*material.smooth(.10,.18,v)*(1-material.smooth(.80,.92,v))*(1-skin)
        target=sheet['mask'].split('?')[0].replace('.faction-mask.png','.correction.png')
        dest=OUT/'Corrections'/target
        correction=np.asarray(Image.open(dest).convert('RGBA')).copy() if dest.exists() else np.zeros(pixels.shape,np.uint8)
        coverage=np.zeros(pixels.shape[:2],bool)
        if mounted:
            solid=np.asarray(Image.fromarray(np.uint8(loose*255)).filter(ImageFilter.MinFilter(9)).filter(ImageFilter.MaxFilter(9)))>127
            for index in (2,3,4,5):
                fx=(index%3)*512;fy=(index//3)*512
                silhouette=Image.fromarray(np.uint8((pixels[fy:fy+512,fx:fx+512,3]>127)*255)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))
                parts=blobs(np.asarray(silhouette)>127)
                if len(parts)<2 and index==2:continue
                if len(parts)<2 and name=='HorseArcher':
                    garment=Image.new('L',(512,512))
                    ImageDraw.Draw(garment).polygon([(204,264),(253,265),(275,295),(251,312),(203,294)],fill=255)
                    coverage[fy:fy+512,fx:fx+512]|=np.asarray(garment)>0
                    continue
                if len(parts)<2:raise ValueError('Cannot isolate thrown rider frame '+str(index+1)+': '+filename)
                for y,x in parts[1]:coverage[fy+y,fx+x]=True
            coverage &= solid
        else:
            frames=relevant['frames']
            for index in (3,4,5):
                f=frames[index]; fx,fy=f['x'],f['y']
                region=Image.new('L',(512,512));draw=ImageDraw.Draw(region)
                if relevant['id']=='death':
                    draw.polygon([(195,145),(365,145),(350,300),(215,330)],fill=255)
                else:
                    draw.polygon([(105,160),(355,160),(320,270),(155,270)],fill=255)
                sub=(np.asarray(region)>0)&(loose[fy:fy+512,fx:fx+512]>.5)
                coverage[fy:fy+512,fx:fx+512]|=sub
        new=coverage&(pixels[...,3]>20)&(correction[...,3]==0)
        correction[new]=[0,255,0,255]
        dest.parent.mkdir(parents=True,exist_ok=True)
        Image.fromarray(correction).save(dest)
        print(name,filename,'local garment additions:',int(new.sum()))



