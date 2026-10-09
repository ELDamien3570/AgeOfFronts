from pathlib import Path
import json
root=Path('Art/Cultures/Russians/Units/BronzeAge/BronzeAxeman')
p=root/'animations.json';data=json.loads(p.read_text(encoding='utf-8'))
clip=next(c for c in data['animations'] if c['id']=='charge-attack')
changes=[]
for i,targetY in [(2,273.5),(3,210.5),(4,210.5)]:
 old=dict(clip['frames'][i]['pivot']);clip['frames'][i]['pivot']['y']=targetY
 changes.append({'frame':i,'before':old,'after':clip['frames'][i]['pivot']})
p.write_text(json.dumps(data,indent=2),encoding='utf-8')
(root/'SourceArt'/'ChargeAttack-BronzeMace-v4-Preview-Registration.json').write_text(json.dumps({'reason':'Authored swing roots adjusted to clear overhead mace windup and followthrough in 420px preview. Fixed scale and native pixels unchanged.','changes':changes},indent=2),encoding='utf-8')
generationPath=root/'Generation.json';g=json.loads(generationPath.read_text(encoding='utf-8'))
for pattern in ['*-BronzeMace-Nadir-v4-Cleanup.json','Death-Back-BronzeMace-Nadir-v4-Flat-Correction.json']:
 for source in (root/'SourceArt').glob(pattern):
  g['records'].append(json.loads(source.read_text(encoding='utf-8-sig')))
generationPath.write_text(json.dumps(g,indent=2),encoding='utf-8')

