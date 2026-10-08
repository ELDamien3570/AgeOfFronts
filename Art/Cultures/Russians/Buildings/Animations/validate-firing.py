"""Validate exported animation contracts and preservation, independently of the builder."""
import hashlib,json,math
from pathlib import Path
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parent;BUILDINGS=ROOT.parent
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
manifest=read(ROOT/'manifest.json');before=read(ROOT/'Before.json')['images']
changed=[x['file'] for x in before if not Path(x['file']).is_file() or sha(Path(x['file']))!=x['sha256']]
assert not changed,changed
assert len(manifest['assets'])==4 and manifest['clipCount']==16 and manifest['frameCount']==576
counts=dict(clips=0,frames=0,muzzleEvents=0,fixedBaseFrames=0,layerCompositions=0,unclippedFrames=0)
for asset in manifest['assets']:
 rig=read(BUILDINGS/asset['rig']);base=Image.open(BUILDINGS/asset['basePlate']).convert('RGBA');basepix=np.asarray(base)
 folder=(BUILDINGS/asset['rig']).parent;source=Image.open(folder/'layers/Original.png').convert('RGBA')
 # Source masters and static source paint remain preserved outside occlusion repairs.
 assert sha(folder.parent/'Icon.png')==rig['sourceSHA256']
 hole=Image.open(folder/'layers/Repair-Mask.png').convert('L')
 from PIL import ImageFilter
 expanded=hole.filter(ImageFilter.MaxFilter(7));guard=np.zeros(basepix.shape[:2],bool);off=rig['cellOffset'];cell=rig['cellPixels']
 guard[off:off+cell,off:off+cell]=np.asarray(expanded)==0;guard&=np.asarray(source)[:,:,3]>0
 assert np.array_equal(basepix[guard],np.asarray(source)[guard]),asset['id']
 for facing,path in asset['facings'].items():
  p=BUILDINGS/path;meta=read(p);clip=meta['animations']['firing'];size=meta['frameSize']['width']
  assert meta['frameSize']['height']==size and clip['loop']
  assert (p.parent/meta['basePlate']).resolve()==(BUILDINGS/asset['basePlate']).resolve()
  assert len(clip['frames'])==len(clip['kinematics'])==36 and clip['suggestedFramesPerSecond']==50
  full=Image.open(p.parent/clip['file']);weapon=Image.open(p.parent/clip['weaponFile'])
  assert full.mode==weapon.mode=='RGBA' and full.size==weapon.size==(clip['sheetSize']['width'],clip['sheetSize']['height'])
  hashes=set();shotframes=[[] for _ in range(asset['barrelCount'])]
  for rect,k in zip(clip['frames'],clip['kinematics']):
   x,y=rect['x'],rect['y'];assert 0<=x<=full.width-size and 0<=y<=full.height-size
   f=full.crop((x,y,x+size,y+size));w=weapon.crop((x,y,x+size,y+size));fp=np.asarray(f);wp=np.asarray(w)
   assert np.array_equal(fp,np.asarray(Image.alpha_composite(base,w)));counts['layerCompositions']+=1
   stable=wp[:,:,3]==0;assert np.array_equal(fp[stable],basepix[stable]);counts['fixedBaseFrames']+=1
   a=fp[:,:,3];assert a.min()==0 and a.max()==255
   assert not np.any(a[:3]) and not np.any(a[-3:]) and not np.any(a[:,:3]) and not np.any(a[:,-3:]);counts['unclippedFrames']+=1
   hashes.add(hashlib.sha256(f.tobytes()).hexdigest())
   for event in k['shots']:
    barrel=event['barrel']-1;b=rig['barrels'][barrel];recoil=k['barrels'][barrel]['recoilPixels']
    pivot=np.array(rig['mountPivot']);point=np.array(b['muzzle'])*manifest['cellPixels']/512+manifest['cellOffset']
    angle=math.radians(k['angleDegrees']);rot=np.array([[math.cos(angle),-math.sin(angle)],[math.sin(angle),math.cos(angle)]])
    expected=pivot+rot@(point-pivot+[0,recoil]);assert np.linalg.norm(expected-event['muzzle'])<1e-4
    px,py=np.rint(event['muzzle']).astype(int);patch=wp[py-2:py+3,px-2:px+3]
    assert patch[:,:,0].max()>=240 and patch[:,:,3].max()>=240
    shotframes[barrel].append(k['index']);counts['muzzleEvents']+=1
   counts['frames']+=1
  assert len(hashes)>=6 and len(hashes)==clip['distinctPoseCount']
  for barrel,shots in enumerate(shotframes):
   gap=rig['cycleFrames'];assert len(shots)==36/gap
   assert all(b-a==gap for a,b in zip(shots,shots[1:])) and shots[0]+36-shots[-1]==gap
   recoils=[k['barrels'][barrel]['recoilPixels'] for k in clip['kinematics']]
   assert max(recoils)>0 and min(recoils)==0 and max(abs(recoils[i]-recoils[i-1]) for i in range(len(recoils)))<=rig['recoil']
  assert len({k['angleDegrees'] for k in clip['kinematics']})==1
  counts['clips']+=1
report=dict(date='2026-10-07',passed=True,counts=counts,originalImagesPreserved=len(before),changedOriginalImages=changed,scope='Local animation assets only; artistic approval and gameplay integration pending')
(ROOT/'Validation.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
