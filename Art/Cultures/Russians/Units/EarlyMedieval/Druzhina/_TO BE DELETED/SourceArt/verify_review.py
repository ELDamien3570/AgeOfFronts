"""Check served review assets and document the limits of local validation."""
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import quote
import hashlib, json

root=Path(__file__).resolve().parent.parent
base='http://127.0.0.1:9018/'
prefix='Cultures/Russians/Units/EarlyMedieval/Druzhina/'
metadata=json.loads((root/'animations.json').read_text(encoding='utf-8'))
checks=[]
for name in ['Actor_Review.html','animations.json']+[a['file'] for a in metadata['animations']]:
    with urlopen(base+quote(prefix+name),timeout=10) as response:
        data=response.read()
        assert response.status==200
        assert data==(root/name).read_bytes(),name
        checks.append({'file':name,'status':200,'bytes':len(data)})
with urlopen(base+'Cultures/Russians/Units/StoneAge/Clubman/actor-review.js',timeout=10) as response:
    assert response.status==200
    checks.append({'file':'shared actor-review.js','status':response.status,'bytes':len(response.read())})
assert hashlib.sha256((root/'Idle-v3.png').read_bytes()).hexdigest()=='45f6f8cd3f9ecfa165307458c6b5c8d25cbf65f8c54426fe4757522137fc90ab'
result={'date':'2026-10-07','httpChecks':checks,'nativeAtlasesInspected':True,'browserPlaybackVerified':False,'limitation':'Browser automation unavailable because Windows sandbox initialization fails. HTTP checks do not establish browser playback.','userApproval':'Idle-v3 approved; animations pending visual review.','runtimeIntegration':False}
(root/'Browser-Review.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print('Twelve served assets match local files; approved Idle-v3 hash preserved.')
