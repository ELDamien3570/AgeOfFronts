"""Prepare bounded runtime atlases from authored rectangles. Originals are read only."""
from pathlib import Path
from PIL import Image, ImageDraw
from collections import deque
import json, hashlib, argparse
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'Art/Runtime/Ages';OUT.mkdir(parents=True,exist_ok=True)
parser=argparse.ArgumentParser();parser.add_argument('--only',nargs='+',default=[]);args=parser.parse_args()
only=set(args.only)
manifest=json.loads((OUT/'manifest.json').read_text()) if only and (OUT/'manifest.json').exists() else {}
ages=['StoneAge','BronzeAge','ClassicalAge','EarlyMedieval','LateMedieval','EarlyModern','Modern']
def build(key,meta_path):
 if only and key not in only:return
 if key == 'modern-anti-air':
  build_rigid_sam(key, meta_path)
  return
 d=json.loads(meta_path.read_text());clips={};source_hashes={}
 for name,clip in d.get('animations',{}).items():
  frames=clip.get('frames',[])
  if not frames:continue
  columns=min(6,len(frames));atlas=Image.new('RGBA',(columns*128,((len(frames)+columns-1)//columns)*128));opened={}
  for i,f in enumerate(frames):
   file=f.get('sheet') or clip.get('file')
   if file:
    path=meta_path.parent/file
    if path not in opened:
     opened[path]=Image.open(path).convert('RGBA');source_hashes[str(path.relative_to(ROOT)).replace('\\','/')]=hashlib.sha256(path.read_bytes()).hexdigest()
    x,y=f.get('x',0),f.get('y',0);frame=opened[path].crop((x,y,x+f['width'],y+f['height']))
   else:frame=Image.open(meta_path.parent/f['file']).convert('RGBA')
   frame=frame.resize((128,128),Image.Resampling.LANCZOS);atlas.paste(frame,((i%columns)*128,(i//columns)*128))
  if name=='idle':
   poster=f'{key}-portrait.png';atlas.crop((0,0,128,128)).save(OUT/poster,optimize=True)
  filename=f'{key}-{name}.png';atlas.save(OUT/filename,optimize=True)
  clips[name]={'file':filename,'frames':len(frames),'columns':columns,'fps':clip.get('suggestedFramesPerSecond',8),'loop':clip.get('loop',True)}
 manifest[key]={'clips':clips,'facing':d.get('facing','screen-down'),'source':str(meta_path.relative_to(ROOT)).replace('\\','/'),'metadataHash':hashlib.sha256(meta_path.read_bytes().replace(b'\r\n',b'\n')).hexdigest(),'hashes':source_hashes}
 if 'idle' in clips:manifest[key]['poster']=f'{key}-portrait.png'

def build_rigid_sam(key, meta_path):
 # Legacy EraArtwork vehicles use the same rigid-body bake as cohort vehicles,
 # downsampled once to this renderer's 128px atlas contract.
 from rigidVehicleArtwork import prepare_vehicle
 d=json.loads(meta_path.read_text());authored=d['animations']
 clips={**authored,'running':authored['movement']}
 staging=ROOT/'build/rigid-vehicle-bake'/key;staging.mkdir(parents=True,exist_ok=True)
 def save_image(path,image):image.save(path,optimize=True)
 def save_text(path,text):path.write_text(text,encoding='utf-8')
 prepare_vehicle(ROOT,meta_path,d,clips,staging,{},save_image,save_text)
 baked=json.loads((staging/'animations.json').read_text());runtime={}
 audit=OUT/'audit'/key;audit.mkdir(parents=True,exist_ok=True)
 for file in (staging/'audit').glob('*.png'):
  with Image.open(file) as image:
   image.resize((image.width//2,image.height//2),Image.Resampling.LANCZOS).save(audit/file.name,optimize=True)
 for c in baked['animations']:
  name='movement' if c['id']=='running' else c['id']
  image=Image.alpha_composite(Image.open(audit/f"{c['id']}.body.png").convert('RGBA'),Image.open(audit/f"{c['id']}.effects.png").convert('RGBA'))
  filename=f'{key}-{name}.png';image.save(OUT/filename,optimize=True)
  runtime[name]={'file':filename,'frames':len(c['frames']),'columns':min(6,len(c['frames'])),'fps':authored[name].get('suggestedFramesPerSecond',8),'loop':authored[name].get('loop',True)}
  if name=='idle':image.crop((0,0,128,128)).save(OUT/f'{key}-portrait.png',optimize=True)
 manifest[key]={'clips':runtime,'facing':d.get('facing','screen-down'),'source':meta_path.relative_to(ROOT).as_posix(),'metadataHash':baked['metadataHash'],'hashes':baked['hashes'],'poster':f'{key}-portrait.png','rigidBody':{'version':1,'file':f'audit/{key}/body.png','surfaceMask':f'audit/{key}/surface-mask.png'}}
for age in ages:
 for folder,line in [('Melee','infantry'),('Ranged','archer'),('Cavalry','cavalry')]:
  meta=ROOT/f'Art/Soldier Icons/{folder}/{age}/animations.json'
  if meta.exists():build(f'{age.lower()}-{line}',meta)
 for folder,kind in [('Transport','transport'),('Warships','warship'),('Trade','trade')]:
  meta=ROOT/f'Art/Ship Icons/{folder}/{age}/animations.json'
  if meta.exists():build(f'{age.lower()}-{kind}',meta)
 meta=ROOT/f'Art/Trader Icons/{age}/animations.json'
 if meta.exists():build(f'{age.lower()}-trader',meta)
weapons={'bronzeage-siege':'Siege Weapons/BatteringRam_BronzeAge','bronzeage-field-support':'Siege Weapons/SiegeTower_BronzeAge','classicalage-siege':'Siege Weapons/Onager_ClassicalAge','classicalage-field-support':'Field Artillery/Mangonel_ClassicalAge','earlymedieval-siege':'Siege Weapons/Trebuchet_EarlyMedieval','earlymedieval-field-support':'Field Artillery/Ballista_EarlyMedieval','latemedieval-siege':'Siege Weapons/Bombard_LateMedieval','latemedieval-field-support':'Field Artillery/OrganGun_LateMedieval','earlymodern-siege':'Siege Weapons/EarlyHowitzer_EarlyModern','earlymodern-field-support':'Field Artillery/NapoleonicCannon_EarlyModern','modern-siege':'Siege Weapons/ModernHowitzer_Modern','modern-field-support':'Field Artillery/BrowningMachineGunner_Modern','modern-anti-air':'Modern Defense/Vehicles/WheeledSAM_Modern'}
for key,folder in weapons.items():
 meta=ROOT/f'Art/Weapon Icons/{folder}/animations.json'
 if meta.exists():build(key,meta)
# Fit static buildings inside a shared square without clipping. Connected black
# removal is used only for opaque edge backgrounds, preserving interior details.
def static(key,path,poster_only=False):
 if only and key not in only:return
 im=Image.open(path).convert('RGBA')
 if im.getpixel((0,0))[3]>240 and max(im.getpixel((0,0))[:3])<32:
  w,h=im.size;pixels=im.load();seen=set();q=deque([(x,0)for x in range(w)]+[(x,h-1)for x in range(w)]+[(0,y)for y in range(h)]+[(w-1,y)for y in range(h)])
  while q:
   x,y=q.popleft()
   if (x,y)in seen or x<0 or y<0 or x>=w or y>=h:continue
   seen.add((x,y))
   if max(pixels[x,y][:3])>32:continue
   pixels[x,y]=(0,0,0,0);q.extend([(x-1,y),(x+1,y),(x,y-1),(x,y+1)])
 bbox=im.getbbox()
 if bbox:im=im.crop(bbox)
 im.thumbnail((116,116),Image.Resampling.LANCZOS);canvas=Image.new('RGBA',(128,128));canvas.paste(im,((128-im.width)//2,(128-im.height)//2))
 filename=f'{key}{"-portrait" if poster_only else ""}.png';canvas.save(OUT/filename,optimize=True)
 source=str(path.relative_to(ROOT)).replace('\\','/');digest=hashlib.sha256(path.read_bytes()).hexdigest()
 if poster_only:
  manifest[key].update({'poster':filename,'portraitSource':source,'portraitHash':digest})
 else:manifest[key]={'file':filename,'source':source,'hash':digest}
buildings={'city':('City','City'),'factory':('Factory','Factory'),'port':('Port','Port'),'barracks':('Barracks','Barracks'),'archery':('Archery Range','Archery'),'stables':('Stables','Stables'),'depot':('Stables','Stables'),'mine':('Mine','Mine'),'blacksmith':('Blacksmith','Blacksmith'),'armory':('Armory','Armory'),'arms-factory':('Arms Factory','ArmsFactory'),'siege-workshop':('Siege','Siege'),'airstrip':('Military Airstrip','MilitaryAirstrip'),'oil-well':('Oil Well','OilWell'),'oil-rig':('Oil Rig','OilRig'),'missile-silo':('Missile Silo','MissileSilo'),'mirv-launcher':('MIRV Launch Complex','MIRVLaunchComplex')}
for age in ages:
 for kind,(folder,stem)in buildings.items():
  if kind=='depot' and age!='Modern':continue
  path=ROOT/f'Art/Building Icons/{folder}/Top-Down-Correction/{stem}_{age}.png'
  if not path.exists()and kind=='factory'and age=='StoneAge':path=ROOT/'Art/Building Icons/Factory/Top-Down-Correction/Factor_StoneAge.png'
  if path.exists():static(f'building-{age.lower()}-{kind}',path)
for age,folder in [('StoneAge','Palisades'),('BronzeAge','StoneWalls'),('ClassicalAge','MassiveStoneWalls')]:
 static(f'building-{age.lower()}-tower',ROOT/f'Art/Terrain/Wall Kit/{folder}/Tower.png')
static('building-modern-gun-nest',ROOT/'Art/Terrain/Modern Defenses/Gun Nests/AntiInfantry_N.png')
static('building-modern-trench',ROOT/'Art/Terrain/Modern Defenses/Trenches/tiles/00-isolated.png')
static('building-modern-trench',ROOT/'Art/Terrain/Modern Defenses/Trenches/tiles/05-straight-ns.png',poster_only=True)
mirv=ROOT/'Art/Building Icons/MIRV Launch Complex/Top-Down-Correction'
build('building-modern-mirv-launcher',mirv/'animations.json')
static('building-modern-mirv-launcher',mirv/'Icon.png',poster_only=True)
build('mirv',ROOT/'Art/Weapon Icons/Modern Defense/Projectiles/MIRVCarrier_Modern/animations.json')
static('mirv',ROOT/'Art/Weapon Icons/Modern Defense/Projectiles/MIRVCarrier_Modern/Icon.png',poster_only=True)
build('mirv-warhead',ROOT/'Art/Weapon Icons/Modern Defense/Projectiles/MIRVWarhead_Modern/animations.json')
static('mirv-warhead',ROOT/'Art/Weapon Icons/Modern Defense/Projectiles/MIRVWarhead_Modern/Icon.png',poster_only=True)
build('impact-mirv',ROOT/'Art/Weapon Icons/Modern Defense/Effects/MIRVWarheadDetonation_Modern/animations.json')
for key,folder in {'impact-bomb':'AerialBomb','impact-shell':'ArtilleryImpact','impact-naval':'GunshipImpact','impact-icbm':'ICBM','impact-hydrogen':'HydrogenBomb'}.items():
 meta=ROOT/f'Art/Bomb Icons/Explosions/{folder}/animations.json'
 if meta.exists():build(key,meta)
static('building-modern-missile-defence',ROOT/'Art/Building Icons/Missile Silo/Top-Down-Correction/MissileSilo_Modern.png')
for key,path in {'fighter':'Art/Aircraft Icons/Fighter_WWII_TopDown.png','bomber':'Art/Aircraft Icons/Bomber_WWII_TopDown.png','icbm':'Art/Bomb Icons/ICBM_Modern_TopDown.png','hydrogen':'Art/Bomb Icons/HydrogenBomb_Modern_TopDown.png'}.items():
 if (ROOT/path).exists():static(key,ROOT/path)
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(f'Prepared {len(manifest)} definitions; {sum(p.stat().st_size for p in OUT.glob("*.png"))/1048576:.1f} MiB of runtime atlases')
