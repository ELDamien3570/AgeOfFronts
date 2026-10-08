from pathlib import Path
from PIL import Image
import json
p=Path(__file__).parent
plan=json.loads((p/'Animation-Plan.json').read_text())
for ident in ['idle','running','attack','hit','charged','charge','charge-attack','death','death-thrown']:
    f=max(p.glob('Generation-'+ident+'-v*.json'),key=lambda f:int(f.stem.rsplit('-v',1)[1]))
    rec=json.loads(f.read_text());a=Image.open(rec['generatedSource']).getchannel('A')
    cuts=[]
    for col in range(3):
        candidates=[]
        for y in range(490,531):
            vals=list(a.crop((col*512,y,col*512+512,y+1)).get_flattened_data())
            candidates.append((sum(v>16 for v in vals),abs(y-512),y,max(vals)))
        best=min(candidates);cuts.append(best[2])
        assert best[0]==0,(ident,col,'no authored silhouette gutter',best)
    plan['sourceRowCuts'][ident]=cuts
    print(ident,cuts)
(p/'Animation-Plan.json').write_text(json.dumps(plan,indent=2)+'\n')
