"""Read-only pixel inspection and validation of the single-actor source sheets."""
from pathlib import Path
from PIL import Image
from collections import deque
import hashlib
import json

ROOT = Path(__file__).resolve().parent
metadata_path = ROOT / "animations.json"
metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else None
files = [clip["file"] for clip in metadata["animations"]] if metadata else sorted(path.name for path in ROOT.glob("*.png"))
rows, failures = [], []
for filename in files:
    path = ROOT / filename
    image = Image.open(path)
    if image.mode != "RGBA" or image.size != (1536, 1024):
        failures.append(filename + ": expected RGBA 1536x1024")
        continue
    frame_rows, hashes = [], []
    for index in range(6):
        x, y = index % 3 * 512, index // 3 * 512
        crop = image.crop((x, y, x + 512, y + 512))
        alpha = crop.getchannel("A")
        visible = alpha.point(lambda value: 255 if value > 16 else 0)
        bounds = visible.getbbox()
        guards = [(0,0,512,8),(0,504,512,512),(0,0,8,512),(504,0,512,512)]
        maximum = max(alpha.crop(box).getextrema()[1] for box in guards)
        if maximum > 16: failures.append(filename + ": visible art crosses frame guard " + str(index))
        if bounds is None: failures.append(filename + ": empty frame " + str(index))
        digest = hashlib.sha256(crop.tobytes()).hexdigest()
        hashes.append(digest)
        # Registration aid only. Author pivots in animations.json; never fit bounds at playback.
        pixels = crop.load()
        red = Image.new("L",(512,512))
        red.putdata([255 if a>16 and r>55 and r>g*2 and r>b*1.8 else 0 for r,g,b,a in crop.get_flattened_data()])
        from PIL import ImageFilter
        red = red.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
        points = {(px,py) for py in range(48,360) for px in range(50,462) if red.getpixel((px,py))}
        components = []
        while points:
            first=points.pop();queue=deque([first]);component=[first]
            while queue:
                px,py=queue.popleft()
                for neighbor in [(px-1,py),(px+1,py),(px,py-1),(px,py+1)]:
                    if neighbor in points: points.remove(neighbor);queue.append(neighbor);component.append(neighbor)
            if len(component)>1200:
                box=[min(p[0] for p in component),min(p[1] for p in component),max(p[0] for p in component)+1,max(p[1] for p in component)+1]
                if .7<(box[2]-box[0])/(box[3]-box[1])<1.4:
                    components.append({"center":[round(sum(p[axis] for p in component)/len(component),1) for axis in range(2)],"bounds":box,"area":len(component)})
        components.sort(key=lambda item:item["area"],reverse=True)
        center = components[0]["center"] if components else None
        frame_rows.append({"index":index,"visibleBounds":bounds,"guardAlphaMax":maximum,"sha256":digest,"redCapRegistrationAid":center,"redComponents":components})
    if len(set(hashes))<5: failures.append(filename+": fewer than five distinct frames")
    if image.getchannel("A").getextrema()[0]!=0: failures.append(filename+": no fully transparent pixels")
    rows.append({"file":filename,"mode":image.mode,"size":image.size,"alphaExtrema":image.getchannel("A").getextrema(),"sha256":hashlib.sha256(path.read_bytes()).hexdigest(),"uniqueFrames":len(set(hashes)),"frames":frame_rows})
report = {"stage":"single-actor-art-prototype","actorCount":1,"checks":"RGBA, six nonempty distinct frames, eight-pixel visible guards, transparency, source hashes","guardAlphaTolerance":16,"guardNote":"Low-alpha generator residue is recorded, not removed. This certifies visible spill guards, not zero-alpha atlas padding.","visualApproval":"pending user review","engineIntegration":"not integrated","failures":failures,"sheets":rows}
(ROOT / "Validation.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
print(json.dumps({"sheets":len(rows),"failures":failures,"registrationAids":{row["file"]:[frame["redCapRegistrationAid"] for frame in row["frames"]] for row in rows},"bounds":{row["file"]:[frame["visibleBounds"] for frame in row["frames"]] for row in rows}}))
raise SystemExit(1 if failures else 0)
