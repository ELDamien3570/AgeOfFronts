from pathlib import Path
import json,numpy as np
from PIL import Image
root=Path('Art/Cultures/Russians/Units/EarlyModern/MosinNagant')
reg={}
for id,name,centers,width in [
 ('attack','Attack',[(259,182),(259,144),(265,142),(263,143),(267,143),(267,162)],126),
 ('charge-attack','ChargeAttack',[(272,148),(261,145),(263,145),(270,152),(270,152),(273,159)],110)]:
 reg[id]={'file':name+'-Aimed-v3.png','scale':110/width,'pivots':[{'x':x,'y':y+20} for x,y in centers],'measurementMethod':'Manual helmet dome center and median width, approximate 3px.','sourceOrder':[0,1,3,2,4,5]}
(root/'SourceArt'/'Aimed-v3-Registration.json').write_text(json.dumps(reg,indent=2),encoding='utf-8')
p=root/'SourceArt'/'register-aimed-v3.py';s=p.read_text(encoding='utf-8-sig')
s=s.replace("c.update(file=r['file']",'''order=r.get('sourceOrder',list(range(6)))
 sourceFrames=list(c['frames'])
 c['frames']=[dict(sourceFrames[source],index=i,sourceIndex=source) for i,source in enumerate(order)]
 c['sourceFrameOrder']=order
 c.update(file=r['file']''')
p.write_text(s,encoding='utf-8')

