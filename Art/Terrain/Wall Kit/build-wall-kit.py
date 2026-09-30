"""Assemble transparent cardinal wall pieces and independent tower sprites.

Original generated paintings are immutable. Only this art directory is written.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent
CONFIG = json.loads((ROOT/'kit-authoring.json').read_text())
SIZE = CONFIG['tileSize']; C = SIZE/2
BITS = CONFIG['connectionBits']
NAMES = ['isolated','end-n','end-e','corner-ne','end-s','straight-ns','corner-es','junction-nes','end-w','corner-nw','straight-ew','junction-new','corner-sw','junction-nsw','junction-esw','cross']
CORNERS = [3,6,9,12]
TOWER_MASKS = [3,6,7,9,11,12,13,14,15]
Y,X = np.mgrid[0:SIZE,0:SIZE].astype(np.float64)+.5


def write_json(path,data):
    path.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pack_cutout(name,footprint,canvas_size=SIZE):
    source = Image.open(ROOT/'generated'/f'{name}.png').convert('RGBA')
    # Crop around the visible object with an alpha-preserving margin. Raw
    # paintings are retained; small soft contact shadows stay in the cutout.
    bounds = source.getchannel('A').point(lambda value:255 if value>16 else 0).getbbox()
    crop = source.crop((bounds[0]-12,bounds[1]-12,bounds[2]+12,bounds[3]+12))
    scale = footprint/max(crop.size)
    painted = crop.resize((round(crop.width*scale),round(crop.height*scale)),Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA',(canvas_size,canvas_size))
    canvas.alpha_composite(painted,((canvas_size-painted.width)//2,(canvas_size-painted.height)//2))
    return canvas


def periodic_material(name):
    painted = Image.open(ROOT/'generated'/f'{name}.png').convert('RGB').resize((SIZE,SIZE),Image.Resampling.LANCZOS)
    pixels = np.asarray(painted,dtype=np.float64).copy()
    for axis in [1,0]:
        work = pixels if axis==0 else pixels.transpose(1,0,2)
        difference = work[-1]-work[0]
        for index in range(20):
            amount = .5*(1-index/20)**2
            work[index] += difference*amount; work[-1-index] -= difference*amount
        work[-1] = work[0]
    result = np.clip(np.rint(pixels),0,255).astype(np.uint8)
    result[-1] = result[0]; result[:,-1] = result[:,0]
    Image.fromarray(result).save(ROOT/'materials'/f'{name}.png')
    return result.astype(np.float64)


def footprint_distance(mask,width):
    half = width/2
    if not mask: return np.maximum(np.abs(X-C),np.abs(Y-C))-half
    arms = []
    if mask&1: arms.append(np.maximum(np.abs(X-C)-half,Y-C))
    if mask&2: arms.append(np.maximum(np.abs(Y-C)-half,C-X))
    if mask&4: arms.append(np.maximum(np.abs(X-C)-half,C-Y))
    if mask&8: arms.append(np.maximum(np.abs(Y-C)-half,X-C))
    # The center block seats every incoming arm at the same height.
    arms.append(np.maximum(np.abs(X-C),np.abs(Y-C))-half)
    return np.minimum.reduce(arms)


def painted_layer(rgb,alpha):
    pixels = np.dstack([np.clip(np.rint(rgb),0,255),np.clip(np.rint(alpha),0,255)]).astype(np.uint8)
    pixels[pixels[...,3]==0,:3] = 0
    return Image.fromarray(pixels)


def shadow_under(image,offset=3,blur=1.3,opacity=.42):
    alpha = image.getchannel('A').filter(ImageFilter.GaussianBlur(blur)).point(lambda a:round(a*opacity))
    shadow = Image.new('RGBA',image.size,(26,23,17,0)); shadow.putalpha(alpha)
    canvas = Image.new('RGBA',image.size); canvas.alpha_composite(shadow,(offset,offset)); canvas.alpha_composite(image)
    return canvas


def timber_wall(mask,tier,post):
    distance = footprint_distance(mask,tier['bodyWidth'])
    alpha = np.clip(.5-distance,0,1)*255
    grain = (np.sin(X*.13)+np.sin(Y*.09+X*.07))*3
    rgb = np.stack([108+grain,70+grain*.7,35+grain*.4],axis=-1)
    wall = painted_layer(rgb,alpha)
    locations = set()
    for position in range(16,SIZE,32):
        if mask&1 and position<C: locations.add((round(C),position))
        if mask&4 and position>C: locations.add((round(C),position))
        if mask&8 and position<C: locations.add((position,round(C)))
        if mask&2 and position>C: locations.add((position,round(C)))
    if mask not in [5,10]: locations.add((round(C),round(C)))
    for px,py in sorted(locations): wall.alpha_composite(post,(px-post.width//2,py-post.height//2))
    return shadow_under(wall,offset=2,blur=.8,opacity=.36)


def merlon_rectangles(mask,tier):
    half = tier['bodyWidth']/2; length = tier['merlonLength']; depth = tier['merlonDepth']; outset = tier['merlonOutset']
    rectangles = []
    for along in range(16,SIZE,32):
        vertical = (mask&1 and along<C) or (mask&4 and along>C)
        horizontal = (mask&8 and along<C) or (mask&2 and along>C)
        if vertical:
            rectangles += [(C-half-outset,along-length/2,C-half-outset+depth,along+length/2),
                           (C+half+outset-depth,along-length/2,C+half+outset,along+length/2)]
        if horizontal:
            rectangles += [(along-length/2,C-half-outset,along+length/2,C-half-outset+depth),
                           (along-length/2,C+half+outset-depth,along+length/2,C+half+outset)]
    return rectangles


def stone_wall(mask,tier,material):
    distance = footprint_distance(mask,tier['bodyWidth']); coverage = np.clip(.5-distance,0,1)
    inward = -distance; parapet = tier['parapetWidth']
    brightness = np.where(inward<parapet,1.04,.73)
    inner_joint = np.exp(-((inward-parapet)/.85)**2)
    rgb = material*brightness[...,None]*(1-inner_joint[...,None]*.30)
    lip = np.exp(-((inward-1.3)/.8)**2)*coverage
    rgb += lip[...,None]*10
    wall = painted_layer(rgb,coverage*255)
    for rect in merlon_rectangles(mask,tier):
        x0,y0,x1,y1=rect
        sdf = np.maximum.reduce([x0-X,X-x1,y0-Y,Y-y1])
        cap = np.clip(.5-sdf,0,1)
        # Each cap overlaps its supporting parapet; the brighter top and short
        # contact shadow make the wall read as fortification rather than paving.
        highlight = np.exp(-((-sdf-1.2)/.8)**2)*8
        layer = painted_layer(material*1.10+highlight[...,None],cap*255)
        wall.alpha_composite(shadow_under(layer,offset=1,blur=.6,opacity=.38))
    return shadow_under(wall,offset=3 if tier['id']=='StoneWalls' else 5,blur=1.2,opacity=.42)


def normalize_connectors(image,mask,ns,ew):
    pixels = np.asarray(image).copy(); nsp = np.asarray(ns); ewp = np.asarray(ew)
    # One fixed collar is copied on every active edge. No blending of alpha
    # across different wall shapes; the entire RGBA connector is shared.
    band = 8
    if mask&1: pixels[:band] = nsp[:band]
    if mask&4: pixels[-band:] = nsp[-band:]
    if mask&8: pixels[:,:band] = ewp[:,:band]
    if mask&2: pixels[:,-band:] = ewp[:,-band:]
    zero_row = np.zeros_like(pixels[0]); zero_col = np.zeros_like(pixels[:,0])
    pixels[0] = nsp[0] if mask&1 else zero_row
    pixels[-1] = nsp[0] if mask&4 else zero_row
    pixels[:,0] = ewp[:,0] if mask&8 else zero_col
    pixels[:,-1] = ewp[:,0] if mask&2 else zero_col
    pixels[pixels[...,3]==0,:3] = 0
    return Image.fromarray(pixels)


def sample_layout():
    points = [(1,1),(6,1),(6,2),(7,2),(7,5),(2,5),(2,4),(1,4),(1,1)]
    occupied = set()
    for start,end in zip(points,points[1:]):
        x,y=start; dx=(end[0]>x)-(end[0]<x); dy=(end[1]>y)-(end[1]<y)
        occupied.add((x,y))
        while (x,y)!=end: x+=dx; y+=dy; occupied.add((x,y))
    occupied.update([(4,0),(0,6)])
    cells=[]
    for y in range(7):
        row=[]
        for x in range(9):
            if (x,y) not in occupied: row.append(None); continue
            row.append(sum(bit for bit,dx,dy in [(1,0,-1),(2,1,0),(4,0,1),(8,-1,0)] if (x+dx,y+dy) in occupied))
        cells.append(row)
    return {'width':9,'height':7,'cells':cells,'cornerMasks':CORNERS,'recommendedTowerMasks':TOWER_MASKS}


def render_example(tiles,tower,layout,ground,size=40,towers=True):
    image = Image.new('RGBA',(layout['width']*size,layout['height']*size))
    for y,row in enumerate(layout['cells']):
        for x,mask in enumerate(row):
            image.alpha_composite(ground.resize((size,size)),(x*size,y*size))
            if mask is None: continue
            image.alpha_composite(tiles[mask].resize((size,size),Image.Resampling.LANCZOS),(x*size,y*size))
            if towers and mask in TOWER_MASKS: image.alpha_composite(tower.resize((size,size),Image.Resampling.LANCZOS),(x*size,y*size))
    return image


def main():
    (ROOT/'materials').mkdir(exist_ok=True); layout=sample_layout(); write_json(ROOT/'review-layout.json',layout)
    ground=Image.open(ROOT/'preview-ground.png').convert('RGBA'); entries=[]; reviews=[]
    for tier in CONFIG['tiers']:
        folder=ROOT/tier['id']; (folder/'tiles').mkdir(parents=True,exist_ok=True)
        if tier['kind']=='timber':
            post=pack_cutout(tier['postSource'],tier['postSize'],tier['postSize']); post.save(ROOT/'materials'/'PalisadePost.png')
            make=lambda mask:timber_wall(mask,tier,post)
        else:
            material=periodic_material(tier['materialSource']); make=lambda mask:stone_wall(mask,tier,material)
        ns,ew=make(5),make(10)
        atlas=Image.new('RGBA',(1024,1024)); padded=Image.new('RGBA',(1040,1040)); tiles={}; definitions=[]
        for mask,name in enumerate(NAMES):
            tile=normalize_connectors(make(mask),mask,ns,ew); tiles[mask]=tile
            file=f'tiles/{mask:02d}-{name}.png'; tile.save(folder/file,optimize=True)
            x,y=mask%4*SIZE,mask//4*SIZE; atlas.alpha_composite(tile,(x,y))
            px,py=mask%4*(SIZE+4),mask//4*(SIZE+4)
            extruded=np.pad(np.asarray(tile),((2,2),(2,2),(0,0)),mode='edge'); padded.paste(Image.fromarray(extruded),(px,py))
            definitions.append({'mask':mask,'name':name,'connections':[direction for direction,bit in BITS.items() if mask&bit],'file':file,'rect':{'x':x,'y':y,'width':SIZE,'height':SIZE},'paddedRect':{'x':px+2,'y':py+2,'width':SIZE,'height':SIZE},'cornerTowerSlot':mask in CORNERS,'junctionTowerSlot':mask in [7,11,13,14,15]})
        atlas.save(folder/'Wall_Atlas.png',optimize=True); padded.save(folder/'Wall_Atlas_Padded.png',optimize=True)
        tower=pack_cutout(tier['towerSource'],tier['towerFootprint']); tower.save(folder/'Tower.png',optimize=True)
        corner_review=Image.new('RGBA',(512,512))
        for i,mask in enumerate(CORNERS):
            combined=tiles[mask].copy(); combined.alpha_composite(tower); corner_review.alpha_composite(combined,((i%2)*SIZE,(i//2)*SIZE))
        corner_review.save(folder/'Corner_Fit_Review.png',optimize=True)
        review=render_example(tiles,tower,layout,ground); review.save(folder/'Enclosure_Review.png'); reviews.append(review)
        sources=[tier['towerSource'],tier.get('postSource',tier.get('materialSource'))]
        metadata={'schemaVersion':1,'tier':tier['id'],'label':tier['label'],'unlockAge':tier['age'],'unlockAgeLabel':tier['ageLabel'],'tileSize':SIZE,'worldFootprintCells':1,'pivot':{'x':128,'y':128},'connectionBits':BITS,'wallBodyWidth':tier['bodyWidth'],'transparentPiecesOnly':True,'atlas':'Wall_Atlas.png','paddedAtlas':'Wall_Atlas_Padded.png','atlasSize':[1024,1024],'paddedAtlasSize':[1040,1040],'extrusionPixels':2,'tiles':definitions,'tower':{'file':'Tower.png','footprintPixels':tier['towerFootprint'],'pivot':{'x':128,'y':128},'cornerMasks':CORNERS,'optionalJunctionMasks':[7,11,13,14,15],'placement':'Same cell and center pivot as the underlying wall; draw after the wall.','independentAsset':True},'sources':[{'file':f'generated/{source}.png','sha256':sha(ROOT/'generated'/f'{source}.png')} for source in sources],'integrationStatus':'Art kit and preview; actual unlocks, collision and gameplay have not been wired into the game.'}
        write_json(folder/'tiles.json',metadata)
        entries.append({'id':tier['id'],'label':tier['label'],'unlockAge':tier['age'],'unlockAgeLabel':tier['ageLabel'],'metadata':f"{tier['id']}/tiles.json",'atlas':f"{tier['id']}/Wall_Atlas.png",'tower':f"{tier['id']}/Tower.png",'cornerReview':f"{tier['id']}/Corner_Fit_Review.png"})
        print(f"{tier['id']}: 16 transparent wall pieces + separate tower ({tier['age']})",flush=True)
    manifest={'schemaVersion':1,'tierCount':3,'wallTileCount':48,'towerCount':3,'tileSize':SIZE,'connectionBits':BITS,'worldFootprintCells':1,'transparentPiecesOnly':True,'previewGround':'preview-ground.png','previewGroundUsage':'Review background only, not a wall asset','tiers':entries,'preview':'Wall_Kit_Preview.html','status':'Art assets only; renderer, unlock rules and collision integration unverified'}
    write_json(ROOT/'Wall_Kit_Manifest.json',manifest)
    contact=Image.new('RGB',(1080,332),(22,32,25)); draw=ImageDraw.Draw(contact)
    font_path=Path('C:/Windows/Fonts/segoeui.ttf'); font=ImageFont.truetype(str(font_path),16) if font_path.exists() else ImageFont.load_default()
    for i,(tier,review) in enumerate(zip(CONFIG['tiers'],reviews)):
        draw.text((i*360+10,9),tier['ageLabel']+' · '+tier['label'],fill=(233,228,205),font=font); contact.paste(review.convert('RGB'),(i*360,40))
    contact.save(ROOT/'wall-progression-review.png')


if __name__=='__main__': main()
