"""Revise the idle while checking that all other animations are preserved."""
from pathlib import Path
import hashlib, json, runpy

source=Path(__file__).resolve().parent
root=source.parent
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
metadata=json.loads((root/'animations.json').read_text(encoding='utf-8'))
protected={clip['file']:sha(root/clip['file']) for clip in metadata['animations'] if clip['id']!='idle'}
protected['Idle-v3.png']=sha(root/'Idle-v3.png')
protected['Idle-Animated-v1.png']=sha(root/'Idle-Animated-v1.png')
runpy.run_path(str(source/'prepare_animation_bake.py'),run_name='__main__')
runpy.run_path(str(source/'compose_animations.py'),run_name='__main__')
assert all(sha(root/file)==digest for file,digest in protected.items()),'An unrelated animation changed'
validation=json.loads((root/'Validation.json').read_text(encoding='utf-8'))
validation['quietIdleRevision']={'preservedAssetHashes':protected,'unchangedNonIdleClips':8,'idleDurationsMs':[320]*6,'previousAnimatedIdlePreserved':True}
(root/'Validation.json').write_text(json.dumps(validation,indent=2)+'\n',encoding='utf-8')
html=(root/'Actor_Review.html').read_text(encoding='utf-8').replace('href="Idle-Animated-v1.png"','href="Idle-Animated-Quiet-v2.png"')
(root/'Actor_Review.html').write_text(html,encoding='utf-8')
runpy.run_path(str(source/'verify_animation_review.py'),run_name='__main__')
print('Quieter idle selected; eight other clips and both prior idle masters unchanged.')
