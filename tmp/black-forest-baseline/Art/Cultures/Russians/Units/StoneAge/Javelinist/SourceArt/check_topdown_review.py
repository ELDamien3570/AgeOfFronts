from pathlib import Path
import json,urllib.request
root=Path(__file__).resolve().parent.parent/'TopDownReview'
data=json.loads((root/'animations.json').read_text())
base='http://127.0.0.1:9007/Cultures/Russians/Units/StoneAge/Javelinist/TopDownReview/'
checks=[]
for name in ['Actor_Review.html','animations.json','../../Clubman/actor-review.js']+[a['file'] for a in data['animations']]:
    with urllib.request.urlopen(base+name) as response:
        assert response.status==200
        checks.append({'file':name,'status':response.status,'bytes':len(response.read())})
(root/'Browser-Review.json').write_text(json.dumps({'httpChecks':checks,'browserPlaybackVerified':False,'userApproval':'Pending animation review','runtimeIntegration':False},indent=2)+'\n')
print('All review resources return HTTP 200; live playback unverified.')
