"""Adapt the established mounted archer bake and validate native atlas gutters."""
from pathlib import Path
from PIL import Image
import json

source=Path(__file__).resolve().parent
root=source.parent
template=root.parent.parent/'ClassicalAge/HorseArcher/SourceArt/compose_animations.py'
code=template.read_text(encoding='utf-8')
code=code.replace('times=[[170]*6','times=[[320]*6')
code=code.replace('Horse breathes and settles; bow remains undrawn.','Nearly still idle: subtle breathing and a small ear or tail-tip twitch; rider and bow stay steady.')
code=code.replace("Generation-'+ident","Generation-motion-'+ident")
code=code.replace("SRC.glob('Generation-*-v*.json')","SRC.glob('Generation-motion-*-v*.json')")
code=code.replace("elif r.get('clip')!='idle' or r.get('file','').startswith('Idle-Animated'):","elif r.get('file','').startswith('Idle-Animated'):")
code=code.replace("g['userApproval']='Idle approved; animations pending review.'","\nfor record in g['records']:\n    if record.get('file')=='Idle-v3.png': record['status']='approved-design-reference'\ng['userApproval']='Idle-v3 approved; animations pending review.'")
code=code.replace('One horse archer. One idle frame.','One mounted bowman. One idle frame.').replace('One horse archer. Nine motions.','One mounted bowman. Nine motions.').replace('Loading horse archer idle design','Loading mounted archer idle')
code=code.replace(".replace('Idle design review'", ".replace('href=\"Idle-v3.png\"','href=\"Idle-Animated-v1.png\"').replace('Idle design review'")
(source/'compose_animations.py').write_text(code,encoding='utf-8')
cuts={};jobs=[]
for ident in ['idle','running','attack','hit','charged','charge','charge-attack','death','death-thrown']:
    path=max(source.glob('Generation-motion-'+ident+'-v*.json'),key=lambda f:int(f.stem.rsplit('-v',1)[1]))
    record=json.loads(path.read_text(encoding='utf-8'))
    im=Image.open(record['generatedSource'])
    assert im.mode=='RGBA' and im.size==(1536,1024),(ident,im.mode,im.size)
    alpha=im.getchannel('A');rows=[]
    for col in range(3):
        options=[]
        for y in range(485,540):
            values=list(alpha.crop((col*512,y,col*512+512,y+1)).get_flattened_data())
            options.append((sum(v>16 for v in values),abs(y-512),y))
        best=min(options)
        assert best[0]==0,(ident,col,'No clear row gutter',best)
        rows.append(best[2])
    cuts[ident]=rows;jobs.append({'id':ident,'file':record['file']});print(ident,rows)
(source/'Animation-Plan.json').write_text(json.dumps({'date':'2026-10-07','approvedDesign':'Idle-v3.png','sourceRowCuts':cuts,'jobs':jobs},indent=2)+'\n',encoding='utf-8')
