"""Uniformly pack the generated trade paintings and transform their authored pins.

Generated files remain untouched. Alpha is preserved through crop/resampling;
no black-matte extraction or painted hull reconstruction is used for traders.
"""
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent
SIZE = 1254
TARGET_HEIGHT = 1140


def main():
    authored = json.loads((ROOT/'rig-authoring.json').read_text())
    (ROOT/'masks').mkdir(exist_ok=True)
    rigs, placements = {}, {}
    for age, spec in authored.items():
        image = Image.open(ROOT/'generated'/f'Trade_{age}.png').convert('RGBA')
        alpha = np.asarray(image.getchannel('A'))
        _, _, stats, _ = cv2.connectedComponentsWithStats((alpha>16).astype(np.uint8),8)
        x,y,w,h,_ = stats[1+np.argmax(stats[1:,cv2.CC_STAT_AREA])]
        # Ignore invisible stray alpha for framing only. Preserve the alpha in
        # the cropped painting, including rope gaps and antialiased edges.
        crop = (int(x)-4,int(y)-4,int(x+w)+4,int(y+h)+4)
        scale = TARGET_HEIGHT/(crop[3]-crop[1])
        resized = image.crop(crop).resize((round((crop[2]-crop[0])*scale),TARGET_HEIGHT),Image.Resampling.LANCZOS)
        offset = (round(SIZE/2+(crop[0]-image.width/2)*scale),(SIZE-TARGET_HEIGHT)//2)
        master = Image.new('RGBA',(SIZE,SIZE),(0,0,0,0))
        master.alpha_composite(resized,offset)
        master.save(ROOT/f'Trade_{age}.png',optimize=True)
        def point(p):
            return [round(offset[0]+(p[0]-crop[0])*scale,3),round(offset[1]+(p[1]-crop[1])*scale,3)]
        rigs[age] = {
            'hull': [point(p) for p in spec['hull']],
            'sails': [[[point(p) for p in polygon],round(amplitude*scale,3)] for polygon,amplitude in spec['sails']],
            'flags': [{'polygon':[point(p) for p in flag['polygon']],'pin':point(flag['pin'])} for flag in spec.get('flags',[])],
            'bow':point(spec['bow']),'stern':point(spec['stern']),
        }
        if 'bows' in spec: rigs[age]['bows'] = [point(p) for p in spec['bows']]
        for index, flag in enumerate(spec.get('flags',[])):
            if 'maskRegion' not in flag: continue
            # Isolate the complete pennant component; a rough polygon leaves
            # static edge fragments behind when its cloth moves.
            x0,y0,x1,y1 = flag['maskRegion']
            roi = (alpha[y0:y1,x0:x1]>16).astype(np.uint8)
            _, labels, areas, _ = cv2.connectedComponentsWithStats(roi,8)
            label = 1+np.argmax(areas[1:,cv2.CC_STAT_AREA])
            component = Image.fromarray((labels==label).astype(np.uint8)*255).filter(ImageFilter.MaxFilter(5))
            mask = Image.new('L',image.size,0); mask.paste(component,(x0,y0))
            mask.save(ROOT/'masks'/f'flag-{age}-generated.png')
            packed = Image.new('L',(SIZE,SIZE),0)
            packed.paste(mask.crop(crop).resize(resized.size,Image.Resampling.LANCZOS),offset)
            name = f'masks/flag-{age}-native.png'; packed.save(ROOT/name)
            rigs[age]['flags'][index]['maskFile'] = 'Trade/'+name
        placements[age] = {'generated':f'generated/Trade_{age}.png','crop':crop,'scale':scale,'offset':offset,'nativeSize':SIZE,'generatedAlphaPreserved':True}
        print(f'{age}: packed master and sail/flag pins',flush=True)
    (ROOT.parent/'trade-rigs.json').write_text(json.dumps(rigs,indent=2)+'\n')
    (ROOT/'master-placement.json').write_text(json.dumps(placements,indent=2)+'\n')


if __name__ == '__main__': main()
