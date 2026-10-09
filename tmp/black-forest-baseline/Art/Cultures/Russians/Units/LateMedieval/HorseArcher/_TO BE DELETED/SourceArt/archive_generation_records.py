"""Keep motion generation records separate from approved idle design provenance."""
from pathlib import Path
import json
root=Path(__file__).resolve().parent.parent
source=root/'SourceArt'
ids=['idle','walk','attack','hit','charged-impact','charge','charge-attack','death','death-thrown']
for ident in ids:
    p=source/('Generation-'+ident+'-v1.json')
    record=json.loads(p.read_text(encoding='utf-8'))
    if ident=='idle' and 'id' not in record:
        assert (source/'Generation-motion-idle-v1.json').exists()
        continue
    assert record['id']==ident
    (source/('Generation-motion-'+ident+'-v1.json')).write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
generation=json.loads((root/'Generation.json').read_text(encoding='utf-8'))
original=generation['records'][0]
assert 'id' not in original
(source/'Generation-idle-v1.json').write_text(json.dumps(original,indent=2)+'\n',encoding='utf-8')
print('Original design provenance retained; nine motion records saved separately.')
