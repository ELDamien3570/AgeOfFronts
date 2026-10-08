"""Select whole connected actor rectangles from native sheets, including grid overhangs."""
from pathlib import Path
from PIL import Image,ImageFilter
import numpy as np
import json,sys
src=Path(__file__).resolve().parent
p=src/'Animation-Generation.json'
gen=json.loads(p.read_text(encoding='utf-8'))
for rec in gen['records']:
    if rec['status']!='selected-source':continue
    if len(sys.argv)>1 and rec['id']!=sys.argv[1]:continue
    native=Image.open(src/rec['nativeFile']); alpha=np.array(native.getchannel('A'))
    mask=alpha>16; visited=np.zeros(mask.shape,dtype=bool); components=[]; labels=np.zeros(mask.shape,dtype=np.int32); label_id=0
    for y,x in zip(*np.where(mask)):
        if visited[y,x]:continue
        label_id+=1;stack=[(int(y),int(x))];visited[y,x]=True;count=0;left=right=int(x);top=bottom=int(y)
        while stack:
            cy,cx=stack.pop();labels[cy,cx]=label_id;count+=1;left=min(left,cx);right=max(right,cx);top=min(top,cy);bottom=max(bottom,cy)
            for dy,dx in [(1,0),(-1,0),(0,1),(0,-1)]:
                ny,nx=cy+dy,cx+dx
                if 0<=ny<1024 and 0<=nx<1536 and mask[ny,nx] and not visited[ny,nx]:visited[ny,nx]=True;stack.append((ny,nx))
        if count>500:components.append((count,[max(0,left-3),max(0,top-3),min(1536,right+4),min(1024,bottom+4)],label_id))
    components=sorted(components,reverse=True)[:6]
    assert len(components)==6,(rec['id'],len(components))
    rects=[]; pose_files=[]
    for i in range(6):
        target=(i%3*512+256,i//3*512+256)
        selected=min(components,key=lambda c:((c[1][0]+c[1][2])/2-target[0])**2+((c[1][1]+c[1][3])/2-target[1])**2)
        rect=selected[1];rects.append(rect);components.remove(selected)
        pose=native.crop(tuple(rect));a=np.array(pose);inside=Image.fromarray((labels[rect[1]:rect[3],rect[0]:rect[2]]==selected[2]).astype(np.uint8)*255).filter(ImageFilter.MaxFilter(3));a[:,:,3][np.array(inside)==0]=0
        name=f"Isolated-{rec['id']}-{i}.png";Image.fromarray(a).save(src/name);pose_files.append(name)
    rec['sourceRects']=rects;rec['poseFiles']=pose_files
    print(rec['id'],rects)
gen['cropping']='Whole connected actor bounding rectangles, including native grid overhangs. Selected connected actor composited with native colors and alpha; neighboring actors excluded. Native originals preserved; no repainting.'
p.write_text(json.dumps(gen,indent=2)+'\n',encoding='utf-8')
