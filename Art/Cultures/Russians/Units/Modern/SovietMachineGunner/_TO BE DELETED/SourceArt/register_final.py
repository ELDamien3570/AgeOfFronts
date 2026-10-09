from pathlib import Path
import json,shutil
S=Path(__file__).resolve().parent
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
g=read(S/'Animation-Generation.json');final=read(S/'Final-Registration.json')
for r in final['records']:
    shutil.copy2(r['generatedSource'],S/r['nativeFile'])
    for old in g['records']:
        if old['id']==r['id'] and old['status']=='selected-source':old['status']='superseded'
    g['records']=[old for old in g['records'] if old['nativeFile']!=r['nativeFile']]+[r]
for r in g['records']:
    if r['status']=='selected-source' and r['id'] in final['composition']:r.update(final['composition'][r['id']])
(S/'Animation-Generation.json').write_text(json.dumps(g,indent=2)+'\n',encoding='utf-8')
