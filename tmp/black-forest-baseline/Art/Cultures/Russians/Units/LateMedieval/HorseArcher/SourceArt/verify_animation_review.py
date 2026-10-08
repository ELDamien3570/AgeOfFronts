"""Verify served assets without claiming browser playback or runtime integration."""
from pathlib import Path
from PIL import Image
from urllib.request import urlopen
import json

root=Path(__file__).resolve().parent.parent
meta=json.loads((root/'animations.json').read_text(encoding='utf-8'))
checks=[]
for clip in meta['animations']:
    image=Image.open(root/clip['file'])
    assert image.size==(meta['sheetSize']['width'],meta['sheetSize']['height']),(clip['id'],'Preview loader rejects sheet dimensions',image.size)
    assert len(clip['frames'])==len(clip['durations'])==clip['frameCount'],clip['id']
    for frame in clip['frames']:
        assert 0<=frame['x'] and 0<=frame['y'] and frame['x']+frame['width']<=image.width and frame['y']+frame['height']<=image.height
        assert image.crop((frame['x'],frame['y'],frame['x']+frame['width'],frame['y']+frame['height'])).getchannel('A').getextrema()[1]>0,(clip['id'],'Empty frame')
for name in ['Actor_Review.html','animations.json']+[clip['file'] for clip in meta['animations']]:
    with urlopen('http://127.0.0.1:9018/Cultures/Russians/Units/LateMedieval/HorseArcher/'+name,timeout=10) as response:
        assert response.status==200 and response.read()==(root/name).read_bytes(),name
        checks.append({'file':name,'status':200})
with urlopen('http://127.0.0.1:9018/Cultures/Russians/Units/StoneAge/Clubman/actor-review.js',timeout=10) as response:
    assert response.status==200
    checks.append({'file':'Shared actor-review.js','status':200})
(root/'Browser-Review.json').write_text(json.dumps({'date':'2026-10-07','httpChecks':checks,'nativeAtlasesInspected':True,'browserPlaybackVerified':False,'limitation':'Windows sandbox initialization prevents browser automation; HTTP checks do not prove playback.','userApproval':'Idle-v2 approved; nine animations pending visual review.','runtimeIntegration':False},indent=2)+'\n',encoding='utf-8')
print('Twelve served review assets match; animations ready for visual review.')

