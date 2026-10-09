"""Bake approved eight-age fleet motion; simulation remains untouched."""
import hashlib
import argparse
import json
import math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
EMPTY = (0,0,0,0)
FPS = {'Idle':8, 'Sailing':12, 'Attack':10}
GRID = [{'index':i,'x':i%5*512,'y':i//5*512,'width':512,'height':512} for i in range(10)]
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,v): p.write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
def blank(): return Image.new('RGBA',(512,512),EMPTY)

def prepare(spec):
    source = Image.open(ROOT/spec['poster']).convert('RGBA')
    frame = blank()
    frame.alpha_composite(source.resize((420,420),Image.Resampling.LANCZOS),(46,46))
    pixels = np.asarray(frame).copy()
    protection = Image.new('L',(512,512),0)
    if spec.get('hullProtection'):
        ImageDraw.Draw(protection).polygon([tuple(p) for p in spec['hullProtection']],fill=255)
    for rect in spec.get('protectedRegions',[]):
        ImageDraw.Draw(protection).rectangle(tuple(rect),fill=255)
    protected = np.asarray(protection)>0
    owned = np.zeros((512,512),dtype=bool)
    pieces=[]
    # Assign complete exterior painted pixels to the nearest rigid shaft.
    # A narrow line mask misses rounded blade ends and leaves painted ghosts.
    yy,xx=np.mgrid[0:512,0:512].astype(np.float32)
    distance=np.full((512,512),np.inf,dtype=np.float32)
    owner=np.full((512,512),-1,dtype=np.int16)
    for ordinal,oar in enumerate(spec['oars']):
        gx,gy=oar['pivot'];tx,ty=oar['tip'];vx,vy=tx-gx,ty-gy
        t=np.clip(((xx-gx)*vx+(yy-gy)*vy)/(vx*vx+vy*vy),0,1)
        squared=(xx-gx-t*vx)**2+(yy-gy-t*vy)**2
        nearer=squared<distance
        owner[nearer]=ordinal;distance[nearer]=squared[nearer]
    exterior=(pixels[...,3]>0)&~protected&(distance<26**2)
    for ordinal,oar in enumerate(spec['oars']):
        selected=exterior&(owner==ordinal)
        if not selected.any(): raise ValueError('Empty oar mask: '+oar['name'])
        owned |= selected
        layer=np.zeros_like(pixels);layer[selected]=pixels[selected]
        pieces.append({**oar,'image':Image.fromarray(layer),'mask':Image.fromarray(selected.astype(np.uint8)*255)})
    base=pixels.copy();base[owned]=0
    base=Image.fromarray(base)
    reconstructed=base.copy()
    for piece in pieces: reconstructed.alpha_composite(piece['image'])
    a=np.asarray(reconstructed);b=np.asarray(frame)
    assert np.array_equal(a[b[...,3]>0],b[b[...,3]>0]), 'Oar split changed visible master paint'
    return {'frame':frame,'base':base,'pieces':pieces,'protection':protection,'bounds':frame.getbbox()}

def hull_frame(spec,rig,motion,index):
    phase=math.tau*index/10
    vessel=rig['base'].copy()
    for piece in rig['pieces']:
        amplitude=piece['amplitude'] if motion=='Sailing' else .25
        sign=1 if piece['side']=='port' else -1
        angle=sign*amplitude*math.sin(phase)
        layer=piece['image'].rotate(angle,Image.Resampling.BICUBIC,center=tuple(piece['pivot'])) if abs(angle)>1e-8 else piece['image']
        vessel.alpha_composite(layer)
    return transform_hull(vessel,spec,motion,index)

def transform_hull(vessel,spec,motion,index):
    # Hull and attached water use the same registered rigid transform.
    phase=math.tau*index/10
    yaw=spec['hullYawDegrees']*math.sin(phase)
    vessel=vessel.rotate(yaw,Image.Resampling.BICUBIC,center=(256,256))
    bob=spec['idleBobPixels'] if motion in ['Idle','Attack'] else spec['sailingBobPixels']
    dx=.16*math.sin(phase+.7);dy=bob*math.sin(phase)
    if motion=='Attack':
        kick=[0,0,0,0,.45,.28,.12,0,0,0][index]
        dx += kick if spec['attack']['direction']=='port' else 0
        dy -= kick if spec['attack']['direction']=='forward' else 0
    return vessel.transform((512,512),Image.Transform.AFFINE,(1,0,-dx,0,1,-dy),Image.Resampling.BICUBIC)

def water_frame(spec,rig,index):
    image=blank();draw=ImageDraw.Draw(image)
    anchors=spec['waterAnchors']
    bx,bow=anchors['bow'];sx,stern=anchors['stern']
    down=spec['facing']=='screen-down';direction=1 if down else -1
    # Registered waterline anchors exclude oars, yards, rudders and ornament.
    draw.line([(bx-7,bow-direction*6),(bx,bow+direction*3),(bx+7,bow-direction*6)],
              fill=(174,218,224,78),width=2)
    # A travelling periodic pulse fades to zero before wrapping at the seam.
    for ordinal in range(3):
        t=(index/10+ordinal/3)%1
        opacity=round(115*math.sin(math.pi*t)**2)
        length=10+t*27;width=4+t*13
        end=stern-direction*length
        draw.line([(sx-3,stern),(sx-width,end)],fill=(175,218,223,opacity),width=2)
        draw.line([(sx+3,stern),(sx+width,end)],fill=(175,218,223,opacity),width=2)
        by=bow+direction*(3+t*8)
        draw.arc((bx-8-t*5,by-4,bx+8+t*5,by+4),0 if down else 180,180 if down else 360,fill=(196,230,230,opacity),width=2)
    return transform_hull(image,spec,'Sailing',index)

def weapons_frame(spec,index,starboard=False):
    image=Image.new('RGBA',(1024,1024),EMPTY);draw=ImageDraw.Draw(image)
    attack=spec.get('attack')
    if not attack or index<attack['eventFrame'] or index>=9: return blank()
    step=index-attack['eventFrame'];progress=step/4
    alpha=round(240*(1-progress*.85))
    points=attack['emitters']
    if starboard: points=[[attack['starboardX'],y] for _,y in points]
    for x,y in points:
        if attack['kind'] in ['broadside-cannon','deck-gun']:
            dx=(1 if starboard else -1) if attack['kind']=='broadside-cannon' else 0
            dy=0 if dx else 1
            if step<2:
                r=6 if step==0 else 3
                vertices=[(x+dx*r*2,y+dy*r*2),(x-dy*r,y+dx*r),(x+dy*r,y-dx*r)]
                draw.polygon([(round(a*2),round(b*2)) for a,b in vertices],fill=(255,203,80,alpha))
                draw.ellipse((x*2-3,y*2-3,x*2+3,y*2+3),fill=(255,246,193,alpha))
            # Drifting compact powder smoke, with no terrain or opaque backing.
            sx=x+dx*(6+progress*17);sy=y+dy*(6+progress*17);r=2+progress*6
            draw.ellipse(((sx-r)*2,(sy-r)*2,(sx+r)*2,(sy+r)*2),fill=(188,190,178,round(alpha*.45)))
        else:
            dy=-1 if spec['facing']=='screen-up' else 1
            if attack['kind']=='spear-release':
                py=y+dy*(5+progress*35)
                draw.line([(x*2,(py-dy*10)*2),(x*2,py*2)],fill=(175,136,82,alpha),width=3)
                draw.polygon([(x*2,py*2),((x-2)*2,(py-dy*5)*2),((x+2)*2,(py-dy*5)*2)],fill=(214,219,209,alpha))
            elif attack['kind']=='torpedo':
                py=y+dy*(4+progress*42)
                draw.line([(x*2,(py-dy*14)*2),(x*2,(py-dy*6)*2)],fill=(195,232,229,round(alpha*.7)),width=3)
                draw.rounded_rectangle((x*2-3,py*2-6,x*2+3,py*2+6),radius=2,fill=(186,198,194,alpha))
            elif attack['kind']=='guided-missile':
                py=y+dy*(6+progress*46)
                draw.line([(x*2,(py-dy*20)*2),(x*2,(py-dy*6)*2)],fill=(245,206,104,round(alpha*.65)),width=3)
                draw.ellipse((x*2-3,py*2-5,x*2+3,py*2+5),fill=(228,232,231,alpha))
    return image.resize((512,512),Image.Resampling.LANCZOS)

def render(spec,rig,motion,index,starboard=False):
    vessel=hull_frame(spec,rig,motion,index)
    water=water_frame(spec,rig,index) if motion=='Sailing' else blank()
    weapons=weapons_frame(spec,index,starboard) if motion=='Attack' else blank()
    composite=water.copy();composite.alpha_composite(vessel);composite.alpha_composite(weapons)
    return composite,vessel,water,weapons

def sheet(frames,path):
    image=Image.new('RGBA',(2560,1024),EMPTY)
    for i,f in enumerate(frames):image.alpha_composite(f,(i%5*512,i//5*512))
    image.save(path,optimize=True)

def export(spec,asset,approval):
    folder=ROOT/spec['age']/spec['role'];layers=folder/'layers';layers.mkdir(exist_ok=True)
    assert sha(ROOT/spec['poster'])==asset['sourceSha256'],'Approved master changed'
    rig=prepare(spec);rig['base'].save(layers/'Hull.png',optimize=True)
    rig['protection'].save(layers/'Hull-Protection.png')
    for piece in rig['pieces']:
        piece['image'].save(layers/(piece['name']+'.png'),optimize=True)
        piece['mask'].save(layers/(piece['name']+'-mask.png'))
    save(folder/'rig.json',{'schemaVersion':1,'source':spec['poster'],'sourceSha256':asset['sourceSha256'],
        'frameSize':[512,512],'sourceToFrame':{'scale':420/1254,'offset':[46,46]},
        'authoring':'../../fleet-rig-authoring.json','oars':spec['oars'],
        'oarPolicy':'Only exterior oar pixels rotate rigidly about registered gunwale pivots; protected hull paint remains unchanged.',
        'attack':spec.get('attack'),'waterAnchors':spec['waterAnchors'],
        'approvedFrameReconstruction':'visible pixels exactly preserved at zero oar angle'})
    clips={};preview=[]
    for motion in ['Idle','Sailing']+(['Attack'] if spec.get('attack') else []):
        frames=[render(spec,rig,motion,i) for i in range(10)]
        for ordinal,suffix in [(0,''),(1,'_Vessel')]+([(2,'_Water')] if motion=='Sailing' else [])+([(3,'_Weapons')] if motion=='Attack' else []):
            sheet([f[ordinal] for f in frames],folder/(motion+suffix+'.png'))
        frames[0][0].save(folder/(motion+'-Preview.webp'),save_all=True,append_images=[f[0] for f in frames[1:]],duration=round(1000/FPS[motion]),loop=0,lossless=True)
        passes={'vessel':motion+'_Vessel.png'}
        if motion=='Sailing':passes['water']=motion+'_Water.png'
        if motion=='Attack':passes['weapons']=motion+'_Weapons.png'
        clip={'file':motion+'.png','frameCount':10,'suggestedFramesPerSecond':FPS[motion],
            'loop':motion!='Attack','frames':GRID,'passes':passes}
        if motion=='Attack':
            clip.update(attackKind=spec['attack']['kind'],attackDirection=spec['attack']['direction'],eventFrames=[spec['attack']['eventFrame']],eventFramesAreVisualOnly=True)
            if 'starboardX' in spec['attack']:
                other=[render(spec,rig,motion,i,True) for i in range(10)]
                sheet([f[0] for f in other],folder/'Attack_Starboard.png')
                sheet([f[1] for f in other],folder/'Attack_Starboard_Vessel.png')
                sheet([f[3] for f in other],folder/'Attack_Starboard_Weapons.png')
                clip['starboardVariant']={'file':'Attack_Starboard.png','passes':{'vessel':'Attack_Starboard_Vessel.png','weapons':'Attack_Starboard_Weapons.png'}}
        clips[motion.lower()]=clip
        if motion=='Sailing':preview=[f[0] for f in frames]
    save(folder/'animations.json',{'schemaVersion':1,'cultureId':'russian','unit':spec['label'],
        'age':spec['age'],'category':asset['category'],'camera':'vertical-overhead-orthographic',
        'facing':spec['facing'],'frameSize':{'width':512,'height':512},'sheetSize':{'width':2560,'height':1024},
        'grid':{'columns':5,'rows':2},'frameOrder':'left-to-right-then-next-row','pivot':{'x':256,'y':256},
        'normalizedPivot':{'x':.5,'y':.5},'animations':clips,'source':spec['poster'],'sourceSha256':asset['sourceSha256'],
        'animationApproval':approval,'waterAnchors':spec['waterAnchors'],
        'waterMotion':'Hull-local anchors; same yaw and translation as vessel',
        'timingNote':'Simulation owns movement, attack cadence, missiles, torpedoes and damage. Attack event markers are presentation-only.',
        'integrationStatus':'art review only; not connected to match renderer'})
    asset.update(metadata=f"{spec['age']}/{spec['role']}/animations.json",clips=[c['file'] for c in clips.values()],status='animated-from-approved-master',animationApproval=approval)
    generation_path=folder/'Generation-Manifest.json'
    generation=json.loads(generation_path.read_text(encoding='utf-8'))
    generation.update(visualApproval='approved',animationApproval=approval)
    save(generation_path,generation)
    assert sha(ROOT/spec['poster'])==asset['sourceSha256']
    print(spec['age'],spec['role'],len(clips),'clips',flush=True)
    return preview

def validate(config,baseline):
    checks=[]
    for spec in config['boats']:
        folder=ROOT/spec['age']/spec['role'];meta=json.loads((folder/'animations.json').read_text(encoding='utf-8'))
        for motion,clip in meta['animations'].items():
            image=Image.open(folder/clip['file']).convert('RGBA')
            frames=[image.crop((f['x'],f['y'],f['x']+512,f['y']+512)) for f in clip['frames']]
            unique=len({hashlib.sha256(f.tobytes()).hexdigest() for f in frames})
            guards=[];arrays=[]
            for f in frames:
                a=np.asarray(f,dtype=np.float32);alpha=a[...,3]
                guards.append(not alpha[:8].any() and not alpha[-8:].any() and not alpha[:,:8].any() and not alpha[:,-8:].any())
                a[...,:3]*=a[...,3:4]/255;arrays.append(a)
            delta=[float(np.mean(np.abs(arrays[(i+1)%10]-arrays[i]))) for i in range(10)]
            composed=Image.new('RGBA',(2560,1024),EMPTY)
            for kind in ['water','vessel','weapons']:
                if kind in clip['passes']:composed.alpha_composite(Image.open(folder/clip['passes'][kind]))
            seam=not clip['loop'] or delta[-1]<=max(delta[:-1])*1.2
            record={'age':spec['age'],'role':spec['role'],'motion':motion,'frameCount':10,
                'distinctFrames':unique,'nonemptyFrames':all(f.getbbox() for f in frames),'guardClear':all(guards),
                'dimensionsCorrect':image.size==(2560,1024),'gridCorrect':clip['frames']==GRID,
                'passesMatch':image.tobytes()==composed.tobytes(),'loopSeamComparable':seam,
                'seamDifference':delta[-1],'maxAdjacentDifference':max(delta[:-1])}
            record['passed']=all(record[k] for k in ['nonemptyFrames','guardClear','dimensionsCorrect','gridCorrect','passesMatch','loopSeamComparable']) and unique>=8
            checks.append(record)
            if not record['passed']:print('VALIDATION FAILURE',record,flush=True)
    changed=[p for p,h in baseline.items() if sha(Path(p))!=h]
    report={'schemaVersion':1,'newVessels':17,'primaryClips':len(checks),'primaryFrames':len(checks)*10,
        'previousImagesPreserved':len(baseline),'changedPreviousImages':changed,'checks':checks,
        'passed':not changed and all(c['passed'] for c in checks),'browserVisualQA':'Static images and HTTP verification; live browser inspection unavailable',
        'integrationStatus':'Art review only; match renderer unmodified'}
    save(ROOT/'Review/Fleet-Animation-Validation.json',report)
    if not report['passed']:raise ValueError('Fleet validation failed; inspect report')
    return report

def refresh_water(config):
    changed=set()
    for spec in config['boats']:
        folder=ROOT/spec['age']/spec['role']
        changed.update(folder/name for name in ['Sailing.png','Sailing_Water.png','Sailing-Preview.webp'])
    base=ROOT.parents[2]
    baseline={str(p):sha(p) for area in [ROOT,base/'Ship Icons',base/'Cultures/Russians/Traders',base/'Cultures/Russians/Aircraft']
              for p in area.rglob('*') if p.is_file() and p.suffix.lower() in ['.png','.webp','.gif'] and p not in changed}
    save(ROOT/'Review/Water-Alignment-Preservation-Baseline.json',baseline)
    checks=[]
    for spec in config['boats']:
        folder=ROOT/spec['age']/spec['role'];rig=prepare(spec)
        for name,point in spec['waterAnchors'].items():
            if name not in ['bow','stern']: continue
            x,y=point
            assert np.asarray(rig['frame'])[round(y),round(x),3]>100, 'Anchor outside hull paint: '+spec['label']+' '+name
        vessel_sheet=Image.open(folder/'Sailing_Vessel.png').convert('RGBA')
        water=[water_frame(spec,rig,i) for i in range(10)];composite=[]
        for i,w in enumerate(water):
            v=vessel_sheet.crop((i%5*512,i//5*512,i%5*512+512,i//5*512+512))
            f=w.copy();f.alpha_composite(v);composite.append(f)
        sheet(water,folder/'Sailing_Water.png');sheet(composite,folder/'Sailing.png')
        composite[0].save(folder/'Sailing-Preview.webp',save_all=True,append_images=composite[1:],duration=83,loop=0,lossless=True)
        for file in ['rig.json','animations.json']:
            path=folder/file;meta=json.loads(path.read_text(encoding='utf-8'));meta['waterAnchors']=spec['waterAnchors'];meta['waterMotion']='Hull-local anchors; same yaw and translation as vessel';save(path,meta)
        checks.append({'age':spec['age'],'role':spec['role'],'anchors':spec['waterAnchors'],'anchorsInsidePaint':True})
        print(spec['age'],spec['role'],'water realigned',flush=True)
    report=validate(config,baseline)
    save(ROOT/'Review/Water-Alignment-Validation.json',{'passed':True,'vessels':17,'waterFrames':170,
        'unchangedImages':len(baseline),'idleAttackVesselPassesPreserved':True,'checks':checks,
        'animationFrameChecksPassed':report['passed']})
    # A distinct corrected preview preserves the previous review GIFs.
    for age in dict.fromkeys(s['age'] for s in config['boats']):
        specs=[s for s in config['boats'] if s['age']==age];boards=[]
        sheets=[Image.open(ROOT/s['age']/s['role']/'Sailing.png').convert('RGBA') for s in specs]
        for i in range(10):
            board=Image.new('RGBA',(320*len(specs),360),(32,66,76,255));draw=ImageDraw.Draw(board)
            for n,(spec,image) in enumerate(zip(specs,sheets)):
                frame=image.crop((i%5*512,i//5*512,i%5*512+512,i//5*512+512)).resize((320,320),Image.Resampling.LANCZOS)
                board.alpha_composite(frame,(n*320,30));draw.text((n*320+10,10),spec['label'],fill=(239,236,219,255))
            boards.append(board.convert('RGB'))
        boards[0].save(ROOT/'Review'/(age+'-Sailing-Water-Aligned.gif'),save_all=True,append_images=boards[1:],duration=[83,83,84]*3+[83],loop=0)
    print('PASSED 17 aligned vessels; 170 water frames;',len(baseline),'other images preserved',flush=True)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--water-only',action='store_true');args=parser.parse_args()
    config=json.loads((ROOT/'fleet-rig-authoring.json').read_text(encoding='utf-8'))
    if config['approval']['status']!='approved':raise ValueError('Approval required')
    if args.water_only: return refresh_water(config)
    base=ROOT.parents[2]
    baseline_path=ROOT/'Review/Fleet-Animation-Preservation-Baseline.json'
    if baseline_path.exists():baseline=json.loads(baseline_path.read_text(encoding='utf-8'))
    else:
        baseline={str(p):sha(p) for area in [ROOT,base/'Ship Icons',base/'Cultures/Russians/Traders',base/'Cultures/Russians/Aircraft'] for p in area.rglob('*') if p.is_file() and p.suffix.lower() in ['.png','.webp','.gif']}
        save(baseline_path,baseline)
    path=ROOT/'Ship_Animation_Manifest.json';catalog=json.loads(path.read_text(encoding='utf-8'))
    previews={}
    for spec in config['boats']:
        asset=next(a for a in catalog['assets'] if a['age']==spec['age'] and a['poster']==spec['poster'])
        previews[(spec['age'],spec['role'])]=export(spec,asset,config['approval'])
    report=validate(config,baseline)
    catalog['clipCount']=sum(len(a['clips']) for a in catalog['assets'])
    catalog['status']='All 26 vessels animated; game integration unverified'
    catalog.setdefault('animationApprovals',{}).update({a:config['approval'] for a in dict.fromkeys(s['age'] for s in config['boats'])})
    save(path,catalog)
    for age in dict.fromkeys(s['age'] for s in config['boats']):
        specs=[s for s in config['boats'] if s['age']==age];frames=[]
        for i in range(10):
            board=Image.new('RGBA',(320*len(specs),360),(32,66,76,255));draw=ImageDraw.Draw(board)
            for n,spec in enumerate(specs):
                frame=previews[(age,spec['role'])][i].resize((320,320),Image.Resampling.LANCZOS)
                board.alpha_composite(frame,(n*320,30));draw.text((n*320+10,10),spec['label'],fill=(239,236,219,255))
            frames.append(board.convert('RGB'))
        frames[0].save(ROOT/'Review'/(age+'-Sailing.gif'),save_all=True,append_images=frames[1:],duration=[83,83,84]*3+[83],loop=0)
    print('PASSED',report['primaryClips'],'clips;',report['primaryFrames'],'frames;',len(baseline),'prior images intact',flush=True)

if __name__=='__main__':main()
