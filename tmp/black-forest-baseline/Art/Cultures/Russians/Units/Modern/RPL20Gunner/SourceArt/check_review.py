from pathlib import Path
import json, urllib.request
root=Path(__file__).resolve().parent.parent
data=json.loads((root/'animations.json').read_text())
base='http://127.0.0.1:9007/Cultures/Russians/Units/Modern/RPL20Gunner/'
names=['Actor_Review.html','animations.json']+[a['file'] for a in data['animations']]
checks=[]
for name in names:
    with urllib.request.urlopen(base+name) as response:
        checks.append({'file':name,'status':response.status,'bytes':len(response.read())})
with urllib.request.urlopen(base+'../../StoneAge/Clubman/actor-review.js') as response:
    assert response.status==200
report={'httpChecks':checks,'sharedReviewScriptStatus':200,'staticFrameValidation':'Validation.json','browserPlaybackVerified':False,'userAnimationApproval':'Pending'}
(root/'Browser-Review.json').write_text(json.dumps(report,indent=2)+'\n')
print('Review page, metadata, shared player and all ten sheets return HTTP 200. Live browser playback remains unverified.')
