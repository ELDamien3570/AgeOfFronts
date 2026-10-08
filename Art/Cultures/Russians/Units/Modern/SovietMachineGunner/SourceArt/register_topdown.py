from pathlib import Path
import json
ROOT=Path(__file__).resolve().parent.parent
p=ROOT/'Generation.json'
data=json.loads(p.read_text(encoding='utf-8-sig'))
r=json.loads((ROOT/'SourceArt/TopDown-Correction.json').read_text(encoding='utf-8-sig'))
if not any(old['file']==r['file'] for old in data['records']):data['records'].append(r)
p.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
