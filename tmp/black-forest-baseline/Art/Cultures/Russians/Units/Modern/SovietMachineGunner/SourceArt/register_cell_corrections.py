from pathlib import Path
import json,shutil
S=Path(__file__).resolve().parent
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
g=read(S/'Animation-Generation.json')
for r in read(S/'Cell-Corrections.json')['records']:
    shutil.copy2(r['generatedSource'],S/r['nativeFile'])
    for old in g['records']:
        if old['id']==r['id'] and old['status']=='selected-source':
            old['status']='superseded';old['supersededReason']='Native source-cell boundary crossing.'
    g['records']=[old for old in g['records'] if old['nativeFile']!=r['nativeFile']]+[r]
(S/'Animation-Generation.json').write_text(json.dumps(g,indent=2)+'\n',encoding='utf-8')
