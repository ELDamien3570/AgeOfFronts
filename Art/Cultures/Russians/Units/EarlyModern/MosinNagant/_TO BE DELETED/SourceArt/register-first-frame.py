from pathlib import Path
from PIL import Image,ImageFilter
import numpy as np,json,hashlib
root=Path('Art/Cultures/Russians/Units/EarlyModern/MosinNagant')
p=root/'Idle-FirstFrame-v1.png';im=Image.open(p);a=np.array(im);alpha=a[:,:,3];yy,xx=np.where(alpha>16)
dil=np.array(Image.fromarray((alpha>128).astype('uint8')*255).filter(ImageFilter.MaxFilter(7)))>0
check={'size':list(im.size),'mode':im.mode,'bounds':[int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1)],'maxAlphaBeyond3px':int(alpha[~dil].max()),'pixelsAbove16Beyond3px':int((alpha[~dil]>16).sum()),'cornerAlpha':int(alpha[:32,:32].max())}
assert im.mode=='RGBA'
width,height=im.size
clip={'id':'idle','label':'First idle frame','file':p.name,'loop':False,'scale':1.06,'frameCount':1,'durations':[1000],'description':'Soviet infantry: khaki uniform, steel helmet and a two-handed Mosin-Nagant ready stance.','frames':[{'index':0,'sourceIndex':0,'x':0,'y':0,'width':width,'height':height,'pivot':{'x':625,'y':595}}],'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
d={'schemaVersion':1,'cultureId':'russians','age':'EarlyModern','unit':'Mosin-Nagant Infantry','category':'Ranged','actorCount':1,'stage':'first-idle-frame-review','integrationStatus':'One design frame for visual review. Animation and match integration pending.','camera':'vertical-overhead-orthographic','facing':'screen-down','sheetSize':{'width':width,'height':height},'grid':{'columns':1,'rows':1},'reviewFootprint':420,'weapon':'Mosin-Nagant bolt-action rifle','uniform':'Soviet infantry, khaki uniform and steel helmet','artRevision':'mosin-first-idle-v1','animations':[clip]}
(root/'animations.json').write_text(json.dumps(d,indent=2),encoding='utf-8')
(root/'Validation.json').write_text(json.dumps(check,indent=2),encoding='utf-8')
g=json.loads((root/'SourceArt'/'Idle-FirstFrame-v1-Generation.json').read_text(encoding='utf-8-sig'))
(root/'Generation.json').write_text(json.dumps({'mode':'built-in-imagegen','selectedFiles':{'idle':p.name},'records':[g],'alphaPolicy':'Native alpha preserved.'},indent=2),encoding='utf-8')
html=Path('Art/Cultures/Russians/Units/BronzeAge/BronzeAxeman/Actor_Review.html').read_text(encoding='utf-8')
html=html.replace('Russian Bronze Mace · Single Actor Review','Russian Mosin-Nagant · First Idle Frame').replace('Age of Fronts · Russians · Bronze Age','Age of Fronts · Russians · Early Modern').replace('Bronze mace animation review.','Mosin-Nagant infantry.').replace('Nine overhead motions with the bronze mace, including both settled corpse poses.','First idle frame · Soviet khaki uniform and steel helmet · strict overhead view.').replace('Shared attack v7','First idle v1').replace('single bronze mace warrior','single Mosin-Nagant soldier').replace('Loading nine sprite sheets…','Loading first idle frame…').replace('revision=bronze-mace-shared-attack-v7','revision=mosin-first-idle-v1')
(root/'Actor_Review.html').write_text(html,encoding='utf-8')
(root/'README.md').write_text('Mosin-Nagant infantry first design frame. Soviet khaki uniform and steel helmet selected by user. Stored in EarlyModern at user request; historical visual reference is Soviet infantry rather than a period Early Modern musketeer. Built-in ImageGen prompt and native source retained in SourceArt. No existing musketeer art or gameplay changed. Static first-frame review; animation awaits visual approval.\n',encoding='utf-8')
print(json.dumps(check))

