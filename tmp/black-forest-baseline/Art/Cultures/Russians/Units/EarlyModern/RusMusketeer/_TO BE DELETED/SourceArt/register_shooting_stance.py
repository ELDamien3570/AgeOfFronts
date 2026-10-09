from pathlib import Path
import json,shutil
ROOT=Path(__file__).resolve().parent.parent
S=ROOT/'SourceArt'
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,d): p.write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
g=read(S/'Animation-Generation.json')
for r in read(S/'Shooting-Stance-v2.json')['records']:
    shutil.copy2(r['generatedSource'],S/r['nativeFile'])
    for old in g['records']:
        if old['id']==r['id'] and old['status']=='selected-source':
            old['status']='superseded'
            old['supersededReason']='User requested right-foot retreat and turned chest for human shooting stance.'
    g['records']=[old for old in g['records'] if old['nativeFile']!=r['nativeFile']]+[r]
write(S/'Animation-Generation.json',g)
