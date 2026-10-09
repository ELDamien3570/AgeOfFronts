import json, hashlib
from pathlib import Path
from PIL import Image
root=Path("Art/Cultures/Russians/Buildings")
review=root/"Review/2026-10-07"
baseline=json.loads((review/"Before.json").read_text())
manifest=json.loads((root/"manifest.json").read_text())
record=json.loads((review/"Camera-Corrections.json").read_text())
sha=lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
mapped=lambda p: "Napoleonic/"+p[len("EarlyModern/"):] if p.startswith("EarlyModern/") else p
fail=[]; unchanged=0; changed=0
for a in baseline["selected"]:
    p=root/mapped(a["file"])
    equal=sha(p)==a["sha256"]
    if a["changed"]:
        changed+=not equal
        if equal: fail.append("requested icon unchanged: "+a["file"])
    else:
        unchanged+=equal
        if not equal: fail.append("other selected icon changed: "+a["file"])
for a in baseline["base"]:
    if sha(a["file"])!=a["sha256"]: fail.append("base changed: "+a["file"])
old_selected={a["file"] for a in baseline["selected"] if a["changed"]}
preserved=0
for a in baseline["masters"]:
    if a["file"] in old_selected: continue
    if sha(root/mapped(a["file"]))!=a["sha256"]: fail.append("prior image changed: "+a["file"])
    else: preserved+=1
images=[]
for a in record["assets"]:
    p=root/a["file"]
    im=Image.open(p); alpha=im.getchannel("A")
    bbox=alpha.point(lambda v:255 if v>=128 else 0).getbbox()
    edge=bbox[0]>0 and bbox[1]>0 and bbox[2]<im.width and bbox[3]<im.height
    master=root/a["age"]/a["selectedSourceFile"]
    valid=im.mode=="RGBA" and im.width==im.height and alpha.getextrema()==(0,255) and edge and sha(p)==sha(master)==sha(a["generatedFile"])
    if not valid: fail.append("image validation: "+a["file"])
    images.append(dict(file=a["file"],size=im.size,mode=im.mode,alphaRange=alpha.getextrema(),solidBounds=bbox,selectedMasterMatches=sha(p)==sha(master),sha256=sha(p),passed=valid))
ages={age:len([a for a in manifest["assets"] if a["age"]==age]) for age in ["Napoleonic","EarlyModern","Modern"]}
if ages["Napoleonic"]!=10 or ages["EarlyModern"]!=0:fail.append("age roster")
for a in manifest["assets"]:
    if not (root/a["file"]).exists():fail.append("missing path: "+a["file"])
if list((root/"EarlyModern").rglob("*.png")):fail.append("new age contains PNGs")
out=dict(date="2026-10-07",scope="source-art and inspection only; not match-runtime integration",passed=not fail,changedRequestedIcons=changed,unchangedOtherSelectedIcons=unchanged,preservedPriorImages=preserved,unchangedBaseImages=len(baseline["base"]),ageCounts=ages,images=images,failures=fail)
(review/"Source-Validation.json").write_text(json.dumps(out,indent=2)+"\n")
print(json.dumps({k:v for k,v in out.items() if k!="images"},indent=2))
raise SystemExit(bool(fail))
