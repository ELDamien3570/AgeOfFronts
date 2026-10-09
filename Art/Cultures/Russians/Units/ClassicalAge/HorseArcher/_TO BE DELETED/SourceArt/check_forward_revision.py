from pathlib import Path
import json,hashlib,sys,shutil
p=Path(__file__).parent.parent
record=p/'SourceArt/Before-Forward-Revision.json'
def sha(f):return hashlib.sha256((p/f).read_bytes()).hexdigest()
if sys.argv[1]=='before':
    m=json.loads((p/'animations.json').read_text(encoding='utf-8'))
    if not record.exists():
        d={'metadata':m,'unchangedClipHashes':{c['id']:{'file':c['file'],'sha256':sha(c['file'])} for c in m['animations'] if c['id'] not in ['attack','charge-attack']}}
        record.write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
else:
    d=json.loads(record.read_text(encoding='utf-8'))
    assert all(sha(c['file'])==c['sha256'] for c in d['unchangedClipHashes'].values()),'Approved non-shot clip changed'
    v=json.loads((p/'Validation.json').read_text(encoding='utf-8'))
    v['approvedNonShotClipsUnchanged']=True
    v['userApproval']='Seven non-shot clips approved; revised bow shots pending user review.'
    (p/'Validation.json').write_text(json.dumps(v,indent=2)+'\n',encoding='utf-8')
    g=json.loads((p/'Generation.json').read_text(encoding='utf-8'))
    g['userApproval']='Seven non-shot clips approved; revised forward bow shots pending review.'
    (p/'Generation.json').write_text(json.dumps(g,indent=2)+'\n',encoding='utf-8')
    m=json.loads((p/'animations.json').read_text(encoding='utf-8'))
    m['shotDirection']='Near straight forward along horse facing; rider twists torso and left-held bow toward screen-down.'
    for c in m['animations']:
        c['reviewStatus']='pending-forward-shot-review' if c['id'] in ['attack','charge-attack'] else 'user-approved'
    (p/'animations.json').write_text(json.dumps(m,indent=2)+'\n',encoding='utf-8')
    print('All seven approved non-shot clip hashes unchanged.')
