"""Export registered painted vehicle motion using the established trader contract."""
import importlib.util
import json
import sys
from pathlib import Path
from PIL import Image

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
module = importlib.util.spec_from_file_location('vehicle_painted_motion', ROOT.parents[2]/'Trader Icons/animate-traders.py')
painted = importlib.util.module_from_spec(module)
module.loader.exec_module(painted)


def prepare(age, spec, source):
    rig = painted.make_rig(age, spec, source)
    if spec.get('nativeSize'):
        size = tuple(spec['nativeSize'])
        if rig['source'].size != size:
            raise ValueError('Vehicle source must match declared native size')
        rig['native'] = rig['source'].copy()
        rig['placement'] = {'crop': [0, 0, *size], 'scale': 1, 'offset': [0, 0], 'generatedSize': list(size)}
    return rig


def frame_vessel(rig, motion, index):
    source = painted.animate_source(rig, motion, index)
    placement = rig['placement']; crop = placement['crop']; scale = placement['scale']
    image = source.crop(crop).resize((round((crop[2]-crop[0])*scale), round((crop[3]-crop[1])*scale)), Image.Resampling.LANCZOS)
    native_size = tuple(rig['spec'].get('nativeSize', [painted.NATIVE, painted.NATIVE]))
    frame_size = tuple(rig['spec'].get('frameSize', [512, 512]))
    native = Image.new('RGBA', native_size, (0,0,0,0))
    native.alpha_composite(image, tuple(placement['offset']))
    extent = (round(frame_size[0]*420/512), round(frame_size[1]*420/512))
    frame = Image.new('RGBA', frame_size, (0,0,0,0))
    frame.alpha_composite(native.resize(extent, Image.Resampling.LANCZOS),
                          ((frame_size[0]-extent[0])//2, (frame_size[1]-extent[1])//2))
    return frame


def export(age, root=ROOT):
    folder = root/age
    spec = json.loads((folder/'rig-authoring.json').read_text(encoding='utf-8'))
    if spec['animationApproval']['status'] != 'approved':
        raise ValueError('Vehicle animation is not authorized')
    source = folder/spec['source']
    if painted.sha(source) != spec['sourceSha256']:
        raise ValueError('Vehicle source master changed')
    rig = prepare(age, spec, source)
    width, height = spec.get('frameSize', [512, 512])
    rig['native'].save(folder/'Source_Transparent.png', optimize=True)
    clips = {}
    for motion in ['Idle', 'Travel']:
        frames = [frame_vessel(rig, motion, i) for i in range(10)]
        sheet = Image.new('RGBA', (width*5, height*2), (0,0,0,0))
        for i, frame in enumerate(frames):
            sheet.alpha_composite(frame, (i%5*width, i//5*height))
        sheet.save(folder/(motion+'.png'), optimize=True)
        fps = 8 if motion == 'Idle' else 12
        frames[0].save(folder/(motion+'.webp'), save_all=True, append_images=frames[1:],
                       duration=round(1000/fps), loop=0, lossless=True)
        clips[motion.lower()] = {'file': motion+'.png', 'frameCount': 10,
            'suggestedFramesPerSecond': fps, 'loop': True,
            'frames': [{'index': i, 'x': i%5*width, 'y': i//5*height,
                        'width': width, 'height': height} for i in range(10)]}
    painted.save_json(folder/'rig.json', {'source': spec['source'],
        'sourceSha256': spec['sourceSha256'], 'placement': rig['placement'], 'parts': spec['parts'],
        'authoring': 'Fixed wheel/axle silhouettes with rolling tread RGB; local cab vibration and covered load suspension.'})
    painted.save_json(folder/'animations.json', {'schemaVersion': 1, 'cultureId': 'russian',
        'unit': spec['label'], 'age': age, 'category': 'OverlandTrader', 'memberCounts': spec['counts'],
        'camera': 'vertical-overhead-orthographic', 'facing': 'screen-down',
        'frameSize': {'width': width, 'height': height}, 'sheetSize': {'width': width*5, 'height': height*2},
        'grid': {'columns': 5, 'rows': 2}, 'pivot': {'x': width//2, 'y': height//2},
        'animations': clips, 'source': spec['source'], 'sourceSha256': spec['sourceSha256'],
        'walkingGroundSpeed': spec['walkingGroundSpeed'], 'animationApproval': spec['animationApproval'],
        'integrationStatus': 'Art review only; not connected to match renderer'})
    path = root/'Trader_Animation_Manifest.json'
    catalog = json.loads(path.read_text(encoding='utf-8'))
    for asset in catalog['assets']:
        if asset['age'] == age:
            asset.update(metadata=age+'/animations.json', status='animations-exported',
                         clips=[age+'/Idle.png', age+'/Travel.png'])
    catalog['clipCount'] = sum(len(a.get('clips', [])) for a in catalog['assets'])
    painted.save_json(path, catalog)
    assert painted.sha(source) == spec['sourceSha256']
    print(f'{age}: truck Idle and Travel exported; source master intact')
    return rig
