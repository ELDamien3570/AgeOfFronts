"""Measure the helmet crown tip to stabilize loops without altering artwork."""
from pathlib import Path
from PIL import Image
import numpy as np
import json, shutil
SOURCE=Path(__file__).resolve().parent
p=SOURCE/'Animation-Generation.json'
gen=json.loads(p.read_text(encoding='utf-8'))
for rec in gen['records']:
    native=SOURCE/rec['nativeFile']
    if not native.exists(): shutil.copy2(rec['generatedSource'],native)
    if rec['status']!='selected-source': continue
    im=Image.open(native)
    assert im.mode=='RGBA' and im.size==(1536,1024)
    roots=[]
    hints={'idle':[330,298,301,312,298,303],'running':[328,283,286,331,297,286],'charge':[308,305,300,308,313,308],'attack':[300],'charge-attack':[289],'hit':[301],'charged':[307],'death':[284],'death-back':[296]}[rec['id']]
    for i in range(len(hints)):
        a=np.array(im.crop((i%3*512,i//3*512,i%3*512+512,i//3*512+512)))
        rgb=a[:,:,:3].astype(int)
        mask=(a[:,:,3]>100)&(rgb[:,:,0]>150)&(rgb[:,:,1]>70)&(rgb[:,:,2]<130)&(rgb[:,:,0]>rgb[:,:,1]*1.15)
        mask[:80]=False; mask[330:]=False; mask[:,:hints[i]-12]=False; mask[:,hints[i]+13:]=False
        ys,xs=np.where(mask)
        assert len(ys), (rec['id'],i,'missing crown anchor')
        top=int(ys.min())
        roots.append([round(float(np.median(xs[ys<top+8]))),top+65])
    if rec['id'] not in ['idle','running','charge']: roots=[roots[0]]*6
    rec['rootOffsets']=[[x-256,y-256] for x,y in roots]
    print(rec['id'],roots)
gen['registration']='Loops aligned at measured helmet crown tip. One fixed first-pose anchor for attacks, impacts and falls preserves intentional body travel.'
p.write_text(json.dumps(gen,indent=2)+'\n',encoding='utf-8')
