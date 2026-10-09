from pathlib import Path
from PIL import Image
import json,hashlib,shutil

p=Path(__file__).parent.parent
rec=json.loads((p/'SourceArt/Generation-idle-v3.json').read_text(encoding='utf-8'))
shutil.copy2(rec['generatedSource'],p/'Idle-v3.png')
im=Image.open(p/'Idle-v3.png');assert im.mode=='RGBA'
w,h=im.size;a=im.getchannel('A')
assert a.getextrema()[0]==0 and a.getextrema()[1]>=240
assert all(a.getpixel(pt)==0 for pt in [(0,0),(w-1,0),(0,h-1),(w-1,h-1)])
m=json.loads((p/'animations.json').read_text(encoding='utf-8'))
m['sheetSize']={'width':w,'height':h}
c=m['animations'][0];c.update(file='Idle-v3.png',scale=w/max(w,h),description='More overhead Druzhina idle with resting lance, visible helmet crown and armored horse back.')
c['frames'][0].update(width=w,height=h,pivot={'x':w/2,'y':h/2})
(p/'animations.json').write_text(json.dumps(m,indent=2)+'\n',encoding='utf-8')
g=json.loads((p/'Generation.json').read_text(encoding='utf-8'))
g['records'][0]['status']='superseded-low-lance-idle-preserved'
g['records'].append({**rec,'status':'selected-overhead-idle-source'})
(p/'Generation.json').write_text(json.dumps(g,indent=2)+'\n',encoding='utf-8')
v={'size':[w,h],'mode':im.mode,'alphaExtrema':a.getextrema(),'visibleBounds':a.getbbox(),'sha256':hashlib.sha256((p/'Idle-v3.png').read_bytes()).hexdigest(),'previousIdleSha256':hashlib.sha256((p/'Idle-v1.png').read_bytes()).hexdigest(),'userApproval':'More overhead idle pending review','runtimeIntegration':False}
(p/'Validation.json').write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
print(json.dumps(v))
