"""Validate production sprites, joins, packing and retained source paintings."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parent; SIZE=256; BITS={'N':1,'E':2,'S':4,'W':8}
failures=[]; counts={'trenchPieces':0,'compatibleEdgePairs':0,'trenchAtlasRects':0,'trenchExtrusions':0,'nestTypes':0,'nestFacings':0,'nestAtlasRects':0,'nestExtrusions':0,'nestCornerFits':0,'nestJunctionFits':0,'preservedSources':0}


def check(value,message):
    if not value: failures.append(message)


def pixels(path):
    with Image.open(path) as image:
        check(image.mode=='RGBA',f'Expected RGBA: {path.relative_to(ROOT)}')
        return np.asarray(image.convert('RGBA')).copy()


def transparency(data,label):
    check(data.shape==(SIZE,SIZE,4),f'{label}: dimensions')
    check(data[...,3].min()==0 and data[...,3].max()==255,f'{label}: missing transparency or solid structure')
    check(np.all(data[data[...,3]==0,:3]==0),f'{label}: color on fully transparent pixels')
    check(data[128,128,3]>=128,f'{label}: missing center coverage')


def packing(data,entry,atlas,padded,label):
    rect=entry['rect']; x,y=rect['x'],rect['y']
    check(np.array_equal(data,atlas[y:y+SIZE,x:x+SIZE]),f'{label}: atlas differs')
    rect=entry['paddedRect']; x,y=rect['x'],rect['y']
    expected=np.pad(data,((2,2),(2,2),(0,0)),mode='edge')
    check(np.array_equal(expected,padded[y-2:y+SIZE+2,x-2:x+SIZE+2]),f'{label}: extrusion differs')


def main():
    manifest=json.loads((ROOT/'Modern_Defenses_Manifest.json').read_text()); metadata=json.loads((ROOT/manifest['trenchMetadata']).read_text()); nests=json.loads((ROOT/manifest['nestMetadata']).read_text())
    check(manifest['connectionBits']==BITS and metadata['connectionBits']==BITS,'Connection bits differ from wall and road convention')
    check(manifest['age']=='Modern' and nests['age']=='Modern','Modern Age label contract')
    reference=json.loads((ROOT.parent/'Wall Kit'/'MassiveStoneWalls'/'tiles.json').read_text())
    check(metadata['trenchBodyWidth']==reference['wallBodyWidth']==80,'Trench does not match massive-wall body width')
    check(metadata['pivot']==reference['pivot']=={'x':128,'y':128},'Trench pivot differs from large walls')
    atlas=pixels(ROOT/'Trenches'/metadata['atlas']); padded=pixels(ROOT/'Trenches'/metadata['paddedAtlas'])
    check(atlas.shape==(1024,1024,4) and padded.shape==(1040,1040,4),'Trench atlas dimensions')
    tiles={}
    for entry in metadata['tiles']:
        mask=entry['mask']; label=f'Trench mask {mask}'; data=pixels(ROOT/'Trenches'/entry['file']); tiles[mask]=data; counts['trenchPieces']+=1
        transparency(data,label); packing(data,entry,atlas,padded,label); counts['trenchAtlasRects']+=1; counts['trenchExtrusions']+=1
        check(entry['connections']==[name for name,bit in BITS.items() if mask&bit],f'{label}: metadata connections')
        exits={'N':data[0,128,3],'E':data[128,-1,3],'S':data[-1,128,3],'W':data[128,0,3]}
        for name,bit in BITS.items(): check(bool(exits[name]>=128)==bool(mask&bit),f'{label}: wrong {name} connector')
    edge_specs=[('N','S',lambda image:image[0],lambda image:image[-1]),('E','W',lambda image:image[:,-1],lambda image:image[:,0]),('S','N',lambda image:image[-1],lambda image:image[0]),('W','E',lambda image:image[:,0],lambda image:image[:,-1])]
    for direction,opposite,edge,neighbor_edge in edge_specs:
        for a in range(16):
            for b in range(16):
                if bool(a&BITS[direction])!=bool(b&BITS[opposite]): continue
                counts['compatibleEdgePairs']+=1; check(np.array_equal(edge(tiles[a]),neighbor_edge(tiles[b])),f'Trench edge mismatch {a} {direction} {b}')
    for nest_type in nests['types']:
        counts['nestTypes']+=1; label=nest_type['id']; folder=ROOT/'Gun Nests'
        atlas=pixels(folder/nest_type['atlas']); padded=pixels(folder/nest_type['paddedAtlas'])
        check(atlas.shape==(256,1024,4) and padded.shape==(260,1040,4),f'{label}: atlas dimensions')
        check(nest_type['independentAsset'] and nest_type['pivot']==metadata['pivot'],f'{label}: independent centered nest contract')
        base=pixels(folder/nest_type['facings'][0]['file'])
        for index,entry in enumerate(nest_type['facings']):
            data=pixels(folder/entry['file']); facing_label=f"{label} {entry['facing']}"; transparency(data,facing_label); counts['nestFacings']+=1
            check(np.array_equal(data,np.rot90(base,-index)),f'{facing_label}: painting changed between facings')
            border=np.concatenate([data[:16,:,3].ravel(),data[-16:,:,3].ravel(),data[:,:16,3].ravel(),data[:,-16:,3].ravel()])
            check(border.max()==0,f'{facing_label}: sprite spills outside its cell')
            packing(data,entry,atlas,padded,facing_label); counts['nestAtlasRects']+=1; counts['nestExtrusions']+=1
            for mask in metadata['nestSlots']:
                combined=Image.fromarray(tiles[mask]); combined.alpha_composite(Image.fromarray(data)); alpha=np.asarray(combined)[...,3]
                rays={'N':alpha[:129,128],'E':alpha[128,128:],'S':alpha[128:,128],'W':alpha[128,:129]}
                for direction,bit in BITS.items():
                    if mask&bit: check(rays[direction].min()>=128,f'{facing_label}: gap on {direction} in trench mask {mask}')
                counts['nestCornerFits' if mask in [3,6,9,12] else 'nestJunctionFits']+=1
    for source in manifest['sources']:
        path=ROOT/source['file']; digest=hashlib.sha256(path.read_bytes()).hexdigest(); original=Path(source['original'])
        check(digest==source['sha256'],f"Source changed: {source['file']}")
        check(original.exists(),f'Missing raw original: {original.name}')
        if original.exists(): check(digest==hashlib.sha256(original.read_bytes()).hexdigest(),f'Source copy differs from original: {path.stem}')
        counts['preservedSources']+=1
    check(counts['trenchPieces']==16 and counts['compatibleEdgePairs']==512 and counts['nestFacings']==8 and counts['nestCornerFits']==32 and counts['nestJunctionFits']==40,'Incomplete audit coverage')
    report={'passed':not failures,'checks':counts,'failures':failures,'scope':'RGBA art, same-tier joins, atlas/extrusion pixels, nest support, pixel-preserving facings and retained originals. Game import, rendering, unlocking, collision and combat are unverified.'}
    (ROOT/'Modern_Defenses_Validation.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8'); print(json.dumps(report,indent=2))
    if failures: raise SystemExit(1)


if __name__=='__main__': main()
