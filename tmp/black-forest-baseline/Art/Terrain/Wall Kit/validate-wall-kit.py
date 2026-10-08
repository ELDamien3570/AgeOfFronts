"""Check the exported art contract; this does not run the game renderer."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
BITS = {'N':1,'E':2,'S':4,'W':8}
CORNERS = [3,6,9,12]
SIZE = 256
failures = []
totals = {'wallPieces':0,'towers':0,'compatibleEdgePairs':0,'atlasRects':0,'paddedExtrusions':0,'cornerFits':0,'preservedSources':0}


def check(condition,message):
    if not condition: failures.append(message)


def pixels(path):
    with Image.open(path) as image:
        check(image.mode=='RGBA',f'{path.relative_to(ROOT)} must be RGBA')
        return np.asarray(image.convert('RGBA')).copy()


def main():
    manifest = json.loads((ROOT/'Wall_Kit_Manifest.json').read_text())
    prompts = json.loads((ROOT/'generation-prompts.json').read_text())
    originals = {row['id']:Path(row['generatedPath']) for row in prompts['sources']}
    check(manifest['connectionBits']==BITS,'Manifest connection bits differ from road convention')
    check(manifest['transparentPiecesOnly'] is True,'Manifest must declare transparent pieces')
    expected_ages = {'Palisades':'StoneAge','StoneWalls':'BronzeAge','MassiveStoneWalls':'ClassicalAge'}
    previews=[]
    for tier in manifest['tiers']:
        folder=ROOT/tier['id']; metadata=json.loads((ROOT/tier['metadata']).read_text())
        check(metadata['unlockAge']==expected_ages[tier['id']],f"Wrong unlock age: {tier['id']}")
        check(metadata['pivot']=={'x':128,'y':128},f"Wrong wall pivot: {tier['id']}")
        check(metadata['connectionBits']==BITS,f"Wrong connection bits: {tier['id']}")
        check(len(metadata['tiles'])==16,f"Expected 16 pieces: {tier['id']}")
        atlas=pixels(folder/metadata['atlas']); padded=pixels(folder/metadata['paddedAtlas'])
        check(atlas.shape==(1024,1024,4),f"Wrong atlas dimensions: {tier['id']}")
        check(padded.shape==(1040,1040,4),f"Wrong padded atlas dimensions: {tier['id']}")
        tiles={}
        for entry in metadata['tiles']:
            mask=entry['mask']; label=f"{tier['id']} mask {mask}"; tile=pixels(folder/entry['file']); tiles[mask]=tile
            totals['wallPieces']+=1
            check(tile.shape==(SIZE,SIZE,4),f'{label}: wrong dimensions')
            check(tile[...,3].min()==0 and tile[...,3].max()==255,f'{label}: missing transparency or solid structure')
            check(np.all(tile[tile[...,3]==0,:3]==0),f'{label}: color data on fully transparent pixels')
            check(tile[128,128,3]>=128,f'{label}: missing center support')
            check(entry['connections']==[name for name,bit in BITS.items() if mask&bit],f'{label}: connections mismatch')
            exits={'N':tile[0,128,3],'E':tile[128,-1,3],'S':tile[-1,128,3],'W':tile[128,0,3]}
            for name,bit in BITS.items():
                check(bool(exits[name]>=128)==bool(mask&bit),f'{label}: wrong {name} exit')
            rect=entry['rect']; x,y=rect['x'],rect['y']
            check(np.array_equal(tile,atlas[y:y+SIZE,x:x+SIZE]),f'{label}: atlas pixels differ'); totals['atlasRects']+=1
            rect=entry['paddedRect']; x,y=rect['x'],rect['y']
            expected=np.pad(tile,((2,2),(2,2),(0,0)),mode='edge')
            check(np.array_equal(expected,padded[y-2:y+SIZE+2,x-2:x+SIZE+2]),f'{label}: extrusion differs'); totals['paddedExtrusions']+=1
        edge_specs=[('N','S',lambda tile:tile[0],lambda tile:tile[-1]),('E','W',lambda tile:tile[:,-1],lambda tile:tile[:,0]),('S','N',lambda tile:tile[-1],lambda tile:tile[0]),('W','E',lambda tile:tile[:,0],lambda tile:tile[:,-1])]
        for direction,opposite,edge,neighbor_edge in edge_specs:
            for a in range(16):
                for b in range(16):
                    if bool(a&BITS[direction])!=bool(b&BITS[opposite]): continue
                    totals['compatibleEdgePairs']+=1
                    check(np.array_equal(edge(tiles[a]),neighbor_edge(tiles[b])),f"{tier['id']}: edge mismatch {a} {direction} {b}")
        tower=pixels(folder/metadata['tower']['file']); totals['towers']+=1
        check(tower.shape==(SIZE,SIZE,4),f"{tier['id']}: tower dimensions")
        check(metadata['tower']['independentAsset'] and metadata['tower']['pivot']==metadata['pivot'],f"{tier['id']}: independent centered tower contract")
        check(tower[...,3].min()==0 and tower[...,3].max()==255,f"{tier['id']}: tower transparency")
        border=np.concatenate([tower[:8,:,3].ravel(),tower[-8:,:,3].ravel(),tower[:,:8,3].ravel(),tower[:,-8:,3].ravel()])
        check(border.max()==0,f"{tier['id']}: tower spills out of its cell")
        check(tower[128,128,3]>=128,f"{tier['id']}: empty tower deck center")
        for mask in CORNERS:
            combined=Image.fromarray(tiles[mask]); combined.alpha_composite(Image.fromarray(tower)); alpha=np.asarray(combined)[...,3]
            # A supported wall must remain visible from the centered tower
            # through each connector, with no transparent gap at their join.
            rays={'N':alpha[:129,128],'E':alpha[128,128:],'S':alpha[128:,128],'W':alpha[128,:129]}
            for name,bit in BITS.items():
                if mask&bit: check(rays[name].min()>=128,f"{tier['id']}: unsupported {name} corner join in mask {mask}")
            totals['cornerFits']+=1
        for source in metadata['sources']:
            path=ROOT/source['file']; digest=hashlib.sha256(path.read_bytes()).hexdigest()
            check(digest==source['sha256'],f"{tier['id']}: retained source hash changed")
            original=originals[path.stem]
            check(original.exists(),f'Missing raw generated original {original.name}')
            if original.exists(): check(digest==hashlib.sha256(original.read_bytes()).hexdigest(),f'Copied source differs from original: {path.stem}')
            totals['preservedSources']+=1
        previews.append((tier,tiles,tower))
    check(totals['wallPieces']==48 and totals['towers']==3,'Incorrect production asset counts')
    check(totals['compatibleEdgePairs']==1536,'Incorrect edge audit coverage')
    report={'passed':not failures,'checks':totals,'failures':failures,'scope':'RGBA art, source preservation, connector pixels, atlas packing and tower support. Game import, renderer, collision and unlock behavior are unverified.'}
    (ROOT/'Wall_Kit_Validation.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    # Native-size samples on both light and dark ground make alpha halos and
    # the small-cell tier progression visible without changing exported art.
    review=Image.new('RGB',(1080,450),(23,32,27)); draw=ImageDraw.Draw(review)
    font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',15)
    for column,(tier,tiles,tower) in enumerate(previews):
        origin=column*360; draw.text((origin+12,12),tier['unlockAgeLabel']+' · '+tier['label'],font=font,fill='#e8e1cb')
        for row,size in enumerate([24,32,64,128]):
            top=310 if size==128 else 44+row*85
            draw.text((origin+12,top+5),f'{size} px',font=font,fill='#b7c9ba')
            for index,(mask,with_tower) in enumerate([(10,False),(3,False),(3,True)]):
                preview=Image.fromarray(tiles[mask]);
                if with_tower: preview.alpha_composite(Image.fromarray(tower))
                # Large samples receive a taller row at the bottom; no clipping.
                sample_size=size
                patch=Image.new('RGBA',(sample_size,sample_size),'#819659' if index<2 else '#454f46')
                patch.alpha_composite(preview.resize((sample_size,sample_size),Image.Resampling.LANCZOS))
                x=origin+73+index*91
                if size==128:
                    # Three 128 px samples don't fit a 360 px column. Keep
                    # only the tower join at true size for this final row.
                    if index!=2: continue
                    x=origin+100
                review.paste(patch.convert('RGB'),(x,top))
    review.save(ROOT/'wall-small-size-review.png')
    print(json.dumps(report,indent=2))
    if failures: raise SystemExit(1)


if __name__=='__main__': main()
