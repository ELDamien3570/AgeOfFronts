from pathlib import Path
import json
from PIL import Image
p=Path('Art/Cultures/Russians/Units/ClassicalAge/RecurveArcher/TopDownReview/animations.json')
d=json.loads(p.read_text())
for ident in ('death','death-back'):
    a=next(a for a in d['animations'] if a['id']==ident)
    f=a['frames'][-1]
    Image.open(p.parent/a['file']).crop((f['x'],f['y'],f['x']+f['width'],f['y']+f['height'])).save('tmp/classical-recurve-'+ident+'.png')
