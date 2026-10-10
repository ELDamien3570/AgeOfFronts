"""Validate the delivered road pixels, atlas packing and connector contracts."""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def edge(pixels, direction):
    return {'N': pixels[0], 'E': pixels[:,-1], 'S': pixels[-1], 'W': pixels[:,0]}[direction]


def main():
    manifest = json.loads((ROOT/'Road_Tile_Manifest.json').read_text())
    ground = np.asarray(Image.open(ROOT/manifest['ground']).convert('RGBA'))
    size = manifest['tileSize']; opposite = {'N':'S','E':'W','S':'N','W':'E'}
    bits = manifest['connectionBits']; reports = []; small = Image.new('RGB',(1140,412),(22,32,25))
    draw = ImageDraw.Draw(small); font_path = Path('C:/Windows/Fonts/segoeui.ttf')
    font = ImageFont.truetype(str(font_path),13) if font_path.exists() else ImageFont.load_default()
    for age_index,age in enumerate(manifest['ages']):
        metadata = json.loads((ROOT/age['metadata']).read_text()); folder = ROOT/age['age']
        atlas = Image.open(folder/metadata['atlas']); padded = Image.open(folder/metadata['paddedAtlas'])
        tiles = {}; tile_checks = []
        for definition in metadata['tiles']:
            image = Image.open(folder/definition['file']); pixels = np.asarray(image); mask = definition['mask']; tiles[mask] = pixels
            rect = definition['rect']; prect = definition['paddedRect']
            cropped = atlas.crop((rect['x'],rect['y'],rect['x']+size,rect['y']+size))
            packed = padded.crop((prect['x']-2,prect['y']-2,prect['x']+size+2,prect['y']+size+2))
            flags = {direction: bool(mask&bit) for direction,bit in bits.items()}
            observed = {direction: int(edge(pixels,direction)[size//2,3])>128 for direction in bits}
            contract = {'mask':mask,'file':definition['file'],'dimensionsCorrect':image.size==(size,size),'transparentGround':image.mode=='RGBA' and all(int(pixels[y,x,3])==0 for y,x in [(0,0),(0,-1),(-1,0),(-1,-1)]) and int(image.getchannel('A').getextrema()[1])==255,'metadataConnectionsCorrect':set(definition['connections'])=={direction for direction,value in flags.items() if value},'exitsCorrect':observed==flags,'atlasMatchesTile':np.array_equal(np.asarray(cropped),pixels),'extrusionCorrect':np.array_equal(np.asarray(packed),np.pad(pixels,((2,2),(2,2),(0,0)),mode='edge'))}
            contract['passed'] = all(value for key,value in contract.items() if key not in ['mask','file'])
            tile_checks.append(contract)
        pair_count = 0; failures = []
        for direction,bit in bits.items():
            other = opposite[direction]; obit = bits[other]
            for a in range(16):
                for b in range(16):
                    if bool(a&bit) != bool(b&obit): continue
                    pair_count += 1
                    difference = np.abs(edge(tiles[a],direction).astype(int)-edge(tiles[b],other).astype(int))
                    if np.any(difference): failures.append({'direction':direction,'firstMask':a,'secondMask':b,'maximumChannelDifference':int(difference.max())})
        entry = {'age':age['age'],'tileCount':len(tiles),'sixteenMasksPresent':set(tiles)==set(range(16)),'distinctTiles':len({hashlib.sha256(pixels.tobytes()).hexdigest() for pixels in tiles.values()}),'atlasDimensionsCorrect':atlas.size==(1024,1024),'paddedAtlasDimensionsCorrect':padded.size==(1040,1040),'originalPaintingPreserved':sha(ROOT/metadata['generatedSource'])==metadata['sourceSha256'],'compatibleEdgePairsChecked':pair_count,'allEdgesMatchExactly':not failures,'edgeFailures':failures,'tiles':tile_checks}
        entry['passed'] = entry['sixteenMasksPresent'] and entry['distinctTiles']==16 and entry['atlasDimensionsCorrect'] and entry['paddedAtlasDimensionsCorrect'] and entry['originalPaintingPreserved'] and entry['allEdgesMatchExactly'] and all(check['passed'] for check in tile_checks)
        reports.append(entry)
        col = age_index*190; draw.text((col+8,8),age['ageLabel'],fill=(233,228,205),font=font)
        draw.text((col+8,28),age['surface'],fill=(178,194,173),font=font)
        for test_size,y in [(24,62),(32,111),(64,172),(128,270)]:
            # A 90-degree bend exposes both the material and its ground margin.
            example = Image.alpha_composite(Image.fromarray(ground).resize((test_size,test_size),Image.Resampling.LANCZOS),Image.fromarray(tiles[3]).resize((test_size,test_size),Image.Resampling.LANCZOS))
            small.paste(example.convert('RGB'),(col+(190-test_size)//2,y)); draw.text((col+8,y),str(test_size),fill=(178,194,173),font=font)
    ground_preserved = sha(ROOT/'generated'/'Ground.png')==manifest['groundSourceSha256']
    passed = len(reports)==6 and sum(r['tileCount'] for r in reports)==96 and ground_preserved and all(r['passed'] for r in reports)
    report = {'schemaVersion':1,'ageCount':len(reports),'roadTileCount':sum(r['tileCount'] for r in reports),'groundPaintingPreserved':ground_preserved,'compatibleEdgePairsChecked':sum(r['compatibleEdgePairsChecked'] for r in reports),'allEdgesMatchExactly':all(r['allEdgesMatchExactly'] for r in reports),'passed':passed,'ages':reports,'scope':'Art and packing validation. Live browser preview and visual review are recorded separately. No game import, pathfinding or trade simulation test is implied.'}
    (ROOT/'Road_Tile_Validation.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    small.save(ROOT/'road-small-size-review.png')
    print(json.dumps({key:report[key] for key in ['ageCount','roadTileCount','compatibleEdgePairsChecked','groundPaintingPreserved','allEdgesMatchExactly','passed']},indent=2))
    if not passed:
        for entry in reports:
            if not entry['passed']: print(entry['age'],entry['edgeFailures'][:4],[check['file'] for check in entry['tiles'] if not check['passed']])
        raise SystemExit(1)


if __name__ == '__main__': main()
