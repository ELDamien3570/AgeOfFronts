"""Build six full-ground cardinal road sets from shared generated paintings.

The user authorized direct material assembly. Original paintings are preserved.
This writes only this art directory; it never changes game terrain or movement.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
SIZE = 256
BITS = {'N': 1, 'E': 2, 'S': 4, 'W': 8}
AGES = ['BronzeAge', 'ClassicalAge', 'EarlyMedieval', 'LateMedieval', 'EarlyModern', 'Modern']
LABELS = ['Bronze Age', 'Classical Age', 'Early Medieval', 'Late Medieval', 'Early Modern', 'Modern']
SURFACES = ['Packed dirt', 'Compacted gravel', 'Rough stone paving', 'Cobblestones', 'Dressed stone paving', 'Asphalt']
NAMES = ['isolated', 'end-n', 'end-e', 'corner-ne', 'end-s', 'straight-ns', 'corner-es', 'junction-nes', 'end-w', 'corner-nw', 'straight-ew', 'junction-new', 'corner-sw', 'junction-nsw', 'junction-esw', 'cross']


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def periodic_material(name):
    image = Image.open(ROOT / 'generated' / f'{name}.png').convert('RGB')
    image = image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    if name == 'Ground':
        image = image.filter(ImageFilter.GaussianBlur(.35))
    if name == 'BronzeAge':
        image = Image.blend(image, image.filter(ImageFilter.GaussianBlur(1.3)), .40)
    pixels = np.asarray(image, dtype=np.float64).copy()
    if name == 'Ground':
        pixels = (pixels - pixels.mean(axis=(0, 1))) * .78 + np.array([127, 148, 88])
    # Gentle corrections on a narrow edge band pair each opposite edge exactly.
    # The original painting is retained separately, without modification.
    band = 22
    for axis in [1, 0]:
        work = pixels if axis == 0 else pixels.transpose(1, 0, 2)
        difference = work[-1] - work[0]
        for index in range(band):
            amount = .5 * (1 - index / band) ** 2
            work[index] += difference * amount
            work[-1-index] -= difference * amount
        work[-1] = work[0]
    pixels = np.clip(np.rint(pixels), 0, 255).astype(np.uint8)
    pixels[-1] = pixels[0]; pixels[:, -1] = pixels[:, 0]
    Image.fromarray(pixels).save(ROOT / 'materials' / f'{name}.png')
    return pixels.astype(np.float64)


Y, X = np.mgrid[0:SIZE, 0:SIZE].astype(np.float64) + .5
C = SIZE / 2
HALF_WIDTH = SIZE * .26


def segment_distance(a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = np.clip(((X-a[0])*dx + (Y-a[1])*dy) / (dx*dx + dy*dy), 0, 1)
    return np.hypot(X - (a[0]+t*dx), Y - (a[1]+t*dy))


def road_geometry(mask):
    # Two adjacent exits form a quarter-circle bend with a common tangent at
    # each edge. Other pieces use attached arms and a rounded central hub.
    corners = {3: (SIZE, 0), 6: (SIZE, SIZE), 9: (0, 0), 12: (0, SIZE)}
    if mask in corners:
        cx, cy = corners[mask]
        radial = np.hypot(X-cx, Y-cy)
        center_distance = np.abs(radial-C)
        signed = center_distance - HALF_WIDTH
    elif mask == 5:
        center_distance = np.abs(X-C); signed = center_distance - HALF_WIDTH
    elif mask == 10:
        center_distance = np.abs(Y-C); signed = center_distance - HALF_WIDTH
    elif mask == 0:
        center_distance = np.hypot(X-C, Y-C)
        signed = center_distance - HALF_WIDTH * .88
    else:
        endpoints = [(1, (C, 0)), (2, (SIZE, C)), (4, (C, SIZE)), (8, (0, C))]
        distances = [segment_distance((C, C), point) for bit, point in endpoints if mask & bit]
        center_distance = np.minimum.reduce(distances)
        if len(distances) >= 3:
            # Smooth the inner junction corners while keeping arm widths fixed.
            smoothing = SIZE * .016
            weights = sum(np.exp(-(distance-center_distance)/smoothing) for distance in distances)
            signed = center_distance - smoothing*np.log(weights) - HALF_WIDTH
        else:
            signed = center_distance - HALF_WIDTH
    return signed, center_distance


def blend(base, color, amount):
    return base * (1-amount[..., None]) + np.asarray(color) * amount[..., None]


SHOULDER = np.array([112, 105, 67], dtype=np.float64)
SHOULDER_WIDTH = 10.0


def clear_ground():
    # Fully transparent cells keep the shoulder RGB, so filtering and edge
    # collars never pull a foreign colour into the road's soft margin.
    pixels = np.zeros((SIZE, SIZE, 4))
    pixels[..., :3] = SHOULDER
    return pixels


def paint(mask, age, material):
    # Roads are cutouts: the map's own terrain shows through everywhere the
    # road and its worn shoulder do not cover, so no biome is baked in.
    signed, center_distance = road_geometry(mask)
    # Narrow irregularity for earthen shoulders; no camera-dependent noise.
    irregularity = np.sin(X*.17+np.sin(Y*.10))*np.cos(Y*.14+X*.035)
    if age in ['BronzeAge', 'ClassicalAge']:
        signed = signed + irregularity * (1.3 if age == 'BronzeAge' else .8)
    result = np.broadcast_to(SHOULDER, (SIZE, SIZE, 3)).copy()
    shoulder = np.clip((SHOULDER_WIDTH-signed)/SHOULDER_WIDTH, 0, 1)
    coverage = np.clip(.5-signed, 0, 1)
    result = blend(result, material, coverage)
    if age in ['EarlyMedieval', 'LateMedieval', 'EarlyModern']:
        curb = np.clip(1.0-np.abs(signed+2.2)/2.5, 0, 1)
        curb_color = [159, 153, 127] if age == 'EarlyModern' else [131, 126, 103]
        result = blend(result, curb_color, curb*.55)
    if age in ['BronzeAge', 'ClassicalAge'] and mask:
        wear = np.exp(-((center_distance-HALF_WIDTH*.44)/5.5)**2) * coverage
        if mask.bit_count() >= 3: wear *= np.clip((np.hypot(X-C,Y-C)-40)/24,0,1)
        result = blend(result, [185, 145, 95] if age == 'BronzeAge' else [186, 170, 132], wear*.16)
    if age == 'Modern' and mask:
        edge_line = np.clip(1.3-np.abs(signed+7)/1.6, 0, 1)*coverage
        result = blend(result, [220, 218, 193], edge_line*.90)
        center_line = np.clip(1.1-np.abs(center_distance-3.1)/1.1,0,1)*coverage
        if mask.bit_count() >= 3:
            center_line *= np.clip((np.hypot(X-C,Y-C)-HALF_WIDTH-8)/18,0,1)
        elif mask.bit_count() == 1:
            # End lane markings before the rounded terminal apron.
            direction = {1: C-Y, 2: X-C, 4: Y-C, 8: C-X}[mask]
            center_line *= np.clip((direction-12)/14,0,1)
        result = blend(result, [230, 194, 84], center_line*.95)
    alpha = np.maximum(coverage, shoulder**1.5*.6)*255
    return np.dstack([result, alpha])


def finish_edges(pixels, mask, clear, north_south, east_west):
    # All tiles share a fixed connector collar. This also makes filtering near
    # cell borders independent of the bend/junction in the tile interior.
    band = 8
    for index in range(band):
        amount = (1-index/band)**2
        targets = [north_south[index] if mask & 1 else clear[index],
                   north_south[-1-index] if mask & 4 else clear[-1-index],
                   east_west[:,index] if mask & 8 else clear[:,index],
                   east_west[:,-1-index] if mask & 2 else clear[:,-1-index]]
        pixels[index] = pixels[index]*(1-amount)+targets[0]*amount
        pixels[-1-index] = pixels[-1-index]*(1-amount)+targets[1]*amount
        pixels[:,index] = pixels[:,index]*(1-amount)+targets[2]*amount
        pixels[:,-1-index] = pixels[:,-1-index]*(1-amount)+targets[3]*amount
    pixels = np.clip(np.rint(pixels),0,255).astype(np.uint8)
    ns = np.clip(np.rint(north_south),0,255).astype(np.uint8)
    ew = np.clip(np.rint(east_west),0,255).astype(np.uint8)
    ground = np.clip(np.rint(clear),0,255).astype(np.uint8)
    # Symmetric terminal profile and periodic texture give exact opposing RGB.
    pixels[0] = ns[0] if mask & 1 else ground[0]
    pixels[-1] = ns[0] if mask & 4 else ground[0]
    pixels[:,0] = ew[:,0] if mask & 8 else ground[:,0]
    pixels[:,-1] = ew[:,0] if mask & 2 else ground[:,0]
    return Image.fromarray(pixels, 'RGBA')


def sample_layout():
    road = set()
    road.update((x,3) for x in range(9)); road.update((4,y) for y in range(7))
    road.update((x,y) for x in range(1,8) for y in [1,5])
    road.update((x,y) for x in [1,7] for y in range(1,6))
    road.update([(2,0),(6,6),(0,6)])
    grid = []
    for y in range(7):
        row = []
        for x in range(9):
            if (x,y) not in road: row.append(None); continue
            mask = sum(bit for bit,dx,dy in [(1,0,-1),(2,1,0),(4,0,1),(8,-1,0)] if (x+dx,y+dy) in road)
            row.append(mask)
        grid.append(row)
    return grid


def render_layout(tiles, ground, layout, cell_size):
    canvas = Image.new('RGBA',(len(layout[0])*cell_size,len(layout)*cell_size))
    for y,row in enumerate(layout):
        for x,mask in enumerate(row):
            cell = ground.resize((cell_size,cell_size),Image.Resampling.LANCZOS)
            if mask is not None:
                cell = Image.alpha_composite(cell, tiles[mask].resize((cell_size,cell_size),Image.Resampling.LANCZOS))
            canvas.paste(cell,(x*cell_size,y*cell_size))
    return canvas


def main():
    (ROOT/'materials').mkdir(exist_ok=True)
    grass = periodic_material('Ground'); ground = Image.fromarray(grass.astype(np.uint8)).convert('RGBA')
    ground.save(ROOT/'Ground.png')
    layout = sample_layout(); write_json(ROOT/'review-layout.json',{'width':9,'height':7,'cells':layout})
    entries = []; reviews = []
    for age,label,surface in zip(AGES,LABELS,SURFACES):
        folder = ROOT/age; (folder/'tiles').mkdir(parents=True,exist_ok=True)
        material = periodic_material(age)
        clear = clear_ground(); ns = paint(5,age,material); ew = paint(10,age,material)
        tiles = {}; atlas = Image.new('RGBA',(SIZE*4,SIZE*4)); padded = Image.new('RGBA',((SIZE+4)*4,(SIZE+4)*4))
        definitions = []
        for mask,name in enumerate(NAMES):
            tile = finish_edges(paint(mask,age,material),mask,clear,ns,ew)
            tiles[mask] = tile; file = f'tiles/{mask:02d}-{name}.png'; tile.save(folder/file,optimize=True)
            x,y = mask%4*SIZE,mask//4*SIZE; atlas.paste(tile,(x,y))
            # Two-pixel extrusion supports sprite-atlas bilinear sampling.
            pixels = np.pad(np.asarray(tile),((2,2),(2,2),(0,0)),mode='edge')
            px,py = mask%4*(SIZE+4),mask//4*(SIZE+4); padded.paste(Image.fromarray(pixels),(px,py))
            definitions.append({'mask':mask,'name':name,'connections':[direction for direction,bit in BITS.items() if mask & bit],'file':file,'rect':{'x':x,'y':y,'width':SIZE,'height':SIZE},'paddedRect':{'x':px+2,'y':py+2,'width':SIZE,'height':SIZE}})
        atlas.save(folder/'Road_Atlas.png',optimize=True); padded.save(folder/'Road_Atlas_Padded.png',optimize=True)
        review = render_layout(tiles,ground,layout,40); review.save(folder/'Route_Example.png')
        reviews.append(review)
        metadata = {'schemaVersion':1,'age':age,'ageLabel':label,'surface':surface,'tileSize':SIZE,'worldFootprintCells':1,'opaqueGround':False,'connectionBits':BITS,'roadWidthPixels':round(HALF_WIDTH*2,2),'atlas':'Road_Atlas.png','atlasSize':[1024,1024],'paddedAtlas':'Road_Atlas_Padded.png','paddedAtlasSize':[1040,1040],'extrusionPixels':2,'tiles':definitions,'generatedSource':f'generated/{age}.png','sourceSha256':sha(ROOT/'generated'/f'{age}.png'),'rotationPolicy':'Use authored mask entries; do not rotate painted materials at runtime.','integrationStatus':'drawn by src/skirmish/client/RoadLayer.ts over the live terrain'}
        write_json(folder/'tiles.json',metadata)
        entries.append({'age':age,'ageLabel':label,'surface':surface,'metadata':f'{age}/tiles.json','atlas':f'{age}/Road_Atlas.png','paddedAtlas':f'{age}/Road_Atlas_Padded.png','example':f'{age}/Route_Example.png'})
        print(f'{age}: 16 transparent-ground connected tiles + atlases',flush=True)
    manifest = {'schemaVersion':1,'ageCount':6,'tilesPerAge':16,'roadTileCount':96,'tileSize':SIZE,'worldFootprintCells':1,'connectionBits':BITS,'ground':'Ground.png','groundSourceSha256':sha(ROOT/'generated'/'Ground.png'),'connectionDirections':'cardinal only, as requested','ages':entries,'preview':'Road_Tile_Preview.html','status':'artwork-only; renderer and trade-route simulation integration unverified'}
    write_json(ROOT/'Road_Tile_Manifest.json',manifest)
    contact = Image.new('RGB',(1080,640),(22,32,25)); draw = ImageDraw.Draw(contact)
    font_path = Path('C:/Windows/Fonts/segoeui.ttf')
    font = ImageFont.truetype(str(font_path),16) if font_path.exists() else ImageFont.load_default()
    for i,(label,surface,review) in enumerate(zip(LABELS,SURFACES,reviews)):
        x,y = i%3*360,i//3*320
        draw.text((x+10,y+9),label+' · '+surface,fill=(233,228,205),font=font)
        contact.paste(review.convert('RGB'),(x,y+35))
    contact.save(ROOT/'road-progression-review.png')


if __name__ == '__main__': main()
