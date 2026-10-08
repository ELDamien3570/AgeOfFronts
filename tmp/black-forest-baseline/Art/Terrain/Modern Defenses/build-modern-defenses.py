"""Assemble cardinal trenches and independent gun nests from retained paintings."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT=Path(__file__).resolve().parent
CONFIG=json.loads((ROOT/'kit-authoring.json').read_text())
SIZE=CONFIG['tileSize']; C=SIZE/2; BITS=CONFIG['connectionBits']
Y,X=np.mgrid[0:SIZE,0:SIZE].astype(float)+.5
NAMES=['isolated','end-n','end-e','corner-ne','end-s','straight-ns','corner-es','junction-nes','end-w','corner-nw','straight-ew','junction-new','corner-sw','junction-nsw','junction-esw','cross']
FACINGS=['N','E','S','W']


def write_json(path,data):
    path.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_cutout(name):
    image=Image.open(ROOT/'generated'/f'{name}.png').convert('RGBA')
    bounds=image.getchannel('A').point(lambda value:255 if value>16 else 0).getbbox()
    return image.crop((bounds[0]-8,bounds[1]-8,bounds[2]+8,bounds[3]+8))


def clean_rgba(image):
    data=np.asarray(image).copy(); data[data[...,3]==0,:3]=0
    return Image.fromarray(data)


def packed_nest(name):
    crop=source_cutout(name); scale=CONFIG['nestFootprintPixels']/max(crop.size)
    painted=crop.resize((round(crop.width*scale),round(crop.height*scale)),Image.Resampling.LANCZOS)
    canvas=Image.new('RGBA',(SIZE,SIZE)); canvas.alpha_composite(painted,((SIZE-painted.width)//2,(SIZE-painted.height)//2))
    return clean_rgba(canvas)


def periodic_material(name):
    image=Image.open(ROOT/'generated'/f'{name}.png').convert('RGB').resize((SIZE,SIZE),Image.Resampling.LANCZOS)
    data=np.asarray(image,dtype=float).copy()
    for axis in [1,0]:
        work=data if axis==0 else data.transpose(1,0,2); difference=work[-1]-work[0]
        for i in range(20):
            amount=.5*(1-i/20)**2; work[i]+=difference*amount; work[-1-i]-=difference*amount
        work[-1]=work[0]
    data=np.clip(np.rint(data),0,255).astype(np.uint8); data[-1]=data[0]; data[:,-1]=data[:,0]
    Image.fromarray(data).save(ROOT/'materials'/f'{name}.png')
    return data.astype(float)


def distance(mask,width):
    half=width/2; arms=[np.maximum(np.abs(X-C),np.abs(Y-C))-half]
    if mask&1: arms.append(np.maximum(np.abs(X-C)-half,Y-C))
    if mask&2: arms.append(np.maximum(np.abs(Y-C)-half,C-X))
    if mask&4: arms.append(np.maximum(np.abs(X-C)-half,C-Y))
    if mask&8: arms.append(np.maximum(np.abs(Y-C)-half,X-C))
    return np.minimum.reduce(arms)


def rgba(rgb,alpha):
    data=np.dstack([np.clip(np.rint(rgb),0,255),np.clip(np.rint(alpha),0,255)]).astype(np.uint8)
    data[data[...,3]==0,:3]=0
    return Image.fromarray(data)


def short_shadow(image):
    alpha=image.getchannel('A').filter(ImageFilter.GaussianBlur(1.1)).point(lambda value:round(value*.30))
    shadow=Image.new('RGBA',image.size,(27,23,17,0)); shadow.putalpha(alpha)
    result=Image.new('RGBA',image.size); result.alpha_composite(shadow,(2,2)); result.alpha_composite(image)
    return result


def trench(mask,earth,wood,bag):
    outer=distance(mask,CONFIG['earthShoulderWidth']); channel=distance(mask,CONFIG['channelWidth'])
    # The surrounding terrain stays transparent. Only disturbed earth within
    # the trench shoulders is painted. A dark channel and shaded inner bank
    # give the excavation depth in plan view without a raised wall silhouette.
    roughness=(np.sin(X*.49+Y*.31)+np.sin(X*.17-Y*.37))*.55
    coverage=np.clip(.5-outer+roughness,0,1)
    brightness=np.where(channel<0,.48,.67+.33*np.clip(channel/15,0,1))
    inner_shadow=np.exp(-((channel+1.5)/2.4)**2)*.16
    painted=rgba(earth*(brightness-inner_shadow)[...,None],coverage*255)
    board_mask=np.clip(.5-distance(mask,CONFIG['duckboardWidth']),0,1)
    vertical=bool(mask&5); horizontal=bool(mask&10)
    vertical_mask=np.clip(.5-distance(mask&5,CONFIG['duckboardWidth']),0,1) if vertical else np.zeros_like(X)
    board_rgb=wood if vertical or not horizontal else wood.transpose(1,0,2)
    if vertical and horizontal:
        board_rgb=np.where((vertical_mask>.5)[...,None],wood,wood.transpose(1,0,2))
    board=rgba(board_rgb*.90,board_mask*255); painted.alpha_composite(board)
    # Sandbags follow the exposed contour of the union, including end caps.
    # Internal boundaries of corners and junctions never receive bags.
    body=distance(mask,CONFIG['trenchBodyWidth']); offset=CONFIG['sandbagOffsetFromCenter']; spacing=CONFIG['sandbagSpacing']
    vertical_bag=bag.transpose(Image.Transpose.ROTATE_90)
    for along in range(spacing//2,SIZE,spacing):
        for px,py,stamp in [(round(C-offset),along,vertical_bag),(round(C+offset),along,vertical_bag),(along,round(C-offset),bag),(along,round(C+offset),bag)]:
            if 1<=body[py,px]<=5: painted.alpha_composite(stamp,(px-stamp.width//2,py-stamp.height//2))
    return short_shadow(painted)


def connectors(image,mask,ns,ew):
    data=np.asarray(image).copy(); north_south=np.asarray(ns); east_west=np.asarray(ew); band=8
    if mask&1: data[:band]=north_south[:band]
    if mask&4: data[-band:]=north_south[-band:]
    if mask&8: data[:,:band]=east_west[:,:band]
    if mask&2: data[:,-band:]=east_west[:,-band:]
    data[0]=north_south[0] if mask&1 else 0; data[-1]=north_south[0] if mask&4 else 0
    data[:,0]=east_west[:,0] if mask&8 else 0; data[:,-1]=east_west[:,0] if mask&2 else 0
    data[data[...,3]==0,:3]=0
    return Image.fromarray(data)


def atlas(images,columns):
    rows=(len(images)+columns-1)//columns
    plain=Image.new('RGBA',(columns*SIZE,rows*SIZE)); padded=Image.new('RGBA',(columns*(SIZE+4),rows*(SIZE+4)))
    for index,image in enumerate(images):
        x,y=index%columns,index//columns; plain.paste(image,(x*SIZE,y*SIZE))
        extruded=Image.fromarray(np.pad(np.asarray(image),((2,2),(2,2),(0,0)),mode='edge')); padded.paste(extruded,(x*(SIZE+4),y*(SIZE+4)))
    return plain,padded


def render_layout(tiles,nests,layout,ground,cell_size,with_nests=True):
    result=Image.new('RGBA',(layout['width']*cell_size,layout['height']*cell_size))
    for y,row in enumerate(layout['cells']):
        for x,mask in enumerate(row):
            position=(x*cell_size,y*cell_size); result.alpha_composite(ground.resize((cell_size,cell_size)),position)
            if mask is None: continue
            result.alpha_composite(tiles[mask].resize((cell_size,cell_size),Image.Resampling.LANCZOS),position)
            if with_nests and mask in CONFIG['nestSlots']:
                nest=nests[(x+y)%2][FACINGS[(x+2*y)%4]]
                result.alpha_composite(nest.resize((cell_size,cell_size),Image.Resampling.LANCZOS),position)
    return result


def main():
    earth=periodic_material('EarthMaterial'); wood=periodic_material('DuckboardMaterial')
    bag=source_cutout('Sandbag').resize((CONFIG['sandbagLength'],CONFIG['sandbagDepth']),Image.Resampling.LANCZOS); bag=clean_rgba(bag); bag.save(ROOT/'materials'/'Sandbag.png')
    ns,ew=trench(5,earth,wood,bag),trench(10,earth,wood,bag)
    tiles=[connectors(trench(mask,earth,wood,bag),mask,ns,ew) for mask in range(16)]
    definitions=[]
    for mask,image in enumerate(tiles):
        path=f'tiles/{mask:02d}-{NAMES[mask]}.png'; image.save(ROOT/'Trenches'/path,optimize=True)
        definitions.append({'mask':mask,'name':NAMES[mask],'connections':[name for name,bit in BITS.items() if mask&bit],'file':path,'rect':{'x':mask%4*SIZE,'y':mask//4*SIZE,'width':SIZE,'height':SIZE},'paddedRect':{'x':mask%4*(SIZE+4)+2,'y':mask//4*(SIZE+4)+2,'width':SIZE,'height':SIZE},'cornerNestSlot':mask in CONFIG['cornerMasks'],'junctionNestSlot':mask in [7,11,13,14,15]})
    plain,padded=atlas(tiles,4); plain.save(ROOT/'Trenches'/'Trench_Atlas.png',optimize=True); padded.save(ROOT/'Trenches'/'Trench_Atlas_Padded.png',optimize=True)
    metadata={'schemaVersion':1,'age':CONFIG['unlockAge'],'ageLabel':CONFIG['unlockAgeLabel'],'tileSize':SIZE,'worldFootprintCells':1,'pivot':{'x':128,'y':128},'connectionBits':BITS,'transparentPiecesOnly':True,'trenchBodyWidth':CONFIG['trenchBodyWidth'],'earthShoulderWidth':CONFIG['earthShoulderWidth'],'channelWidth':CONFIG['channelWidth'],'duckboardWidth':CONFIG['duckboardWidth'],'profileReference':'Wall Kit/MassiveStoneWalls: 80 px body, approximately 104 px outer wall profile','atlas':'Trench_Atlas.png','paddedAtlas':'Trench_Atlas_Padded.png','atlasSize':[1024,1024],'paddedAtlasSize':[1040,1040],'extrusionPixels':2,'tiles':definitions,'nestSlots':CONFIG['nestSlots'],'integrationStatus':'Art assets only; actual unlocks, terrain occupation and combat have not been wired into the game.'}
    write_json(ROOT/'Trenches'/'tiles.json',metadata)
    nest_entries=[]; nests=[]
    transforms=[None,Image.Transpose.ROTATE_270,Image.Transpose.ROTATE_180,Image.Transpose.ROTATE_90]
    for nest_type in CONFIG['nestTypes']:
        base=packed_nest(nest_type['source']); images=[base if transform is None else base.transpose(transform) for transform in transforms]; facing_images={}; facings=[]
        for index,(facing,image) in enumerate(zip(FACINGS,images)):
            file=f"{nest_type['id']}_{facing}.png"; image.save(ROOT/'Gun Nests'/file,optimize=True); facing_images[facing]=image
            facings.append({'facing':facing,'file':file,'rect':{'x':index*SIZE,'y':0,'width':SIZE,'height':SIZE},'paddedRect':{'x':index*(SIZE+4)+2,'y':2,'width':SIZE,'height':SIZE}})
        plain,padded=atlas(images,4); atlas_file=f"{nest_type['id']}_Atlas.png"; padded_file=f"{nest_type['id']}_Atlas_Padded.png"; plain.save(ROOT/'Gun Nests'/atlas_file,optimize=True); padded.save(ROOT/'Gun Nests'/padded_file,optimize=True)
        entry={**nest_type,'atlas':atlas_file,'paddedAtlas':padded_file,'atlasSize':[1024,256],'paddedAtlasSize':[1040,260],'facings':facings,'pivot':{'x':128,'y':128},'independentAsset':True,'footprintPixels':CONFIG['nestFootprintPixels'],'cornerMasks':CONFIG['cornerMasks'],'optionalJunctionMasks':[7,11,13,14,15],'placement':'Draw over the trench in the same cell at the same center pivot and scale. Facings rotate the complete painted emplacement.'}
        nest_entries.append(entry); nests.append(facing_images)
        corner_review=Image.new('RGBA',(512,512))
        for index,mask in enumerate(CONFIG['cornerMasks']):
            combined=tiles[mask].copy(); combined.alpha_composite(base); corner_review.paste(combined,(index%2*SIZE,index//2*SIZE))
        corner_review.save(ROOT/'Gun Nests'/f"{nest_type['id']}_Corner_Fit_Review.png",optimize=True)
    write_json(ROOT/'Gun Nests'/'nests.json',{'schemaVersion':1,'age':CONFIG['unlockAge'],'tileSize':SIZE,'worldFootprintCells':1,'transparentPiecesOnly':True,'extrusionPixels':2,'types':nest_entries})
    prompts=json.loads((ROOT/'generation-prompts.json').read_text()); sources=[{'file':f"generated/{source['id']}.png",'sha256':sha(ROOT/'generated'/f"{source['id']}.png"),'original':source['generatedPath']} for source in prompts['sources']]
    manifest={'schemaVersion':1,'age':CONFIG['unlockAge'],'ageLabel':CONFIG['unlockAgeLabel'],'trenchPieceCount':16,'gunNestTypeCount':2,'gunNestFacingCount':8,'tileSize':SIZE,'connectionBits':BITS,'pivot':{'x':128,'y':128},'transparentPiecesOnly':True,'trenchMetadata':'Trenches/tiles.json','trenchAtlas':'Trenches/Trench_Atlas.png','nestMetadata':'Gun Nests/nests.json','previewGround':'preview-ground.png','previewGroundUsage':'Review background only; not included in production sprites','layout':'review-layout.json','preview':'Modern_Defenses_Preview.html','sources':sources,'integrationStatus':'Art kit and preview only; game rendering, unlocks, collision and combat are unverified.'}
    if (ROOT/'Animations'/'Gun_Animation_Manifest.json').exists():
        manifest.update({'animationMetadata':'Animations/Gun_Animation_Manifest.json','animationPreview':'Animations/Gun_Animation_Preview.html'})
    write_json(ROOT/'Modern_Defenses_Manifest.json',manifest)
    layout=json.loads((ROOT/'review-layout.json').read_text()); ground=Image.open(ROOT/'preview-ground.png').convert('RGBA')
    render_layout(tiles,nests,layout,ground,64).save(ROOT/'connected-trench-review.png')
    review=Image.new('RGB',(1000,565),'#17231b'); draw=ImageDraw.Draw(review); font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',17)
    labels=['Connected trenches','Anti-infantry nest','Anti-air nest']
    for x,label in zip([16,605,805],labels): draw.text((x,15),label,font=font,fill='#e7dfc7')
    review.paste(render_layout(tiles,nests,layout,ground,64).convert('RGB'),(12,57))
    for index in range(2):
        x=606+index*194; sample=Image.new('RGBA',(176,176),'#899d61'); sample.alpha_composite(nests[index]['N'].resize((176,176),Image.Resampling.LANCZOS)); review.paste(sample.convert('RGB'),(x,57))
        for row,size in enumerate([24,32,64,128]):
            top=249+row*44 if size<128 else 421
            draw.text((x,top+5),f'{size} px',font=font,fill='#adc1af')
            sample=Image.new('RGBA',(size,size),'#899d61'); sample.alpha_composite(nests[index]['N'].resize((size,size),Image.Resampling.LANCZOS)); review.paste(sample.convert('RGB'),(x+57,top))
    review.save(ROOT/'modern-defenses-review.png')
    print('Built 16 transparent trench pieces and 2 independent gun nests in 4 facings each.',flush=True)


if __name__=='__main__': main()
