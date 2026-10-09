from pathlib import Path
from PIL import Image
import json,shutil
source=Path(__file__).resolve().parent
for r in json.loads((source/'TopDown-Animation-Generation.json').read_text(encoding='utf-8-sig'))['records']:
    if r['status']!='selected-source':continue
    shutil.copy2(r['generatedSource'],source/r['nativeFile'])
    im=Image.open(source/r['nativeFile']).convert('RGBA')
    for i in range(6):
        x,y=i%3*512,i//3*512
        a=im.crop((x,y,x+512,y+512)).getchannel('A')
        edge=max(a.crop(b).getextrema()[1] for b in [(0,0,512,1),(0,511,512,512),(0,0,1,512),(511,0,512,512)])
        if edge>16:print(r['id'],i,edge)


