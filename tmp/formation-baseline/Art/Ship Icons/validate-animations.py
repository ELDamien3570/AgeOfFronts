"""Validate exported art contracts and write visual review artifacts."""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parent
AGES=["StoneAge","BronzeAge","ClassicalAge","EarlyMedieval","LateMedieval","EarlyModern","Modern"]
LABELS=["Stone Age","Bronze Age","Classical Age","Early Medieval","Late Medieval","Early Modern","Modern"]


def extract(sheet,index):
    return sheet.crop((index%5*512,index//5*512,index%5*512+512,index//5*512+512))


def main():
    catalog=json.loads((ROOT/"Ship_Animation_Manifest.json").read_text(encoding="utf-8"))
    categories=list(dict.fromkeys(asset["category"] for asset in catalog["assets"]))
    clip_columns=max(sum(len(asset["clips"]) for asset in catalog["assets"] if asset["age"]==age) for age in AGES)
    source_hashes=json.loads((ROOT/"original-source-hashes.json").read_text(encoding="utf-8-sig"))
    original_checks=[]
    for entry in source_hashes:
        file=entry["file"].removeprefix("Art/Ship Icons/")
        current=hashlib.sha256((ROOT/file).read_bytes()).hexdigest()
        original_checks.append({"file":file,"unchanged":current==entry["sha256"]})
    checks=[]
    existing_hashes=json.loads((ROOT/"existing-fleet-hashes.json").read_text(encoding="utf-8"))
    existing_checks=[{"file":file,"unchanged":hashlib.sha256((ROOT/file).read_bytes()).hexdigest()==expected} for file,expected in existing_hashes.items()]
    source_checks=[{"file":file,"unchanged":hashlib.sha256((ROOT/file).read_bytes()).hexdigest()==expected} for file,expected in catalog["sourceSha256"].items()]
    overview=Image.new("RGB",(clip_columns*224,7*258),(218,227,230))
    draw=ImageDraw.Draw(overview)
    for age_index,(age,label) in enumerate(zip(AGES,LABELS)):
        column=0
        for category in categories:
            folder=ROOT/category/age
            metadata=json.loads((folder/"animations.json").read_text(encoding="utf-8"))
            rig=json.loads((folder/"rig.json").read_text(encoding="utf-8"))
            for motion,data in metadata["animations"].items():
                path=folder/data["file"]
                sheet=Image.open(path)
                frames=[extract(sheet,i) for i in range(10)]
                edge_clean=[]
                bounds=[]
                for frame in frames:
                    alpha=np.array(frame.getchannel("A"))
                    edge_clean.append(not np.any(np.concatenate([alpha[:8,:].ravel(),alpha[-8:,:].ravel(),alpha[:,:8].ravel(),alpha[:,-8:].ravel()])))
                    bounds.append(frame.getbbox())
                differences=[]
                for i in range(10):
                    first=np.asarray(frames[i],dtype=np.float32)
                    second=np.asarray(frames[(i+1)%10],dtype=np.float32)
                    first[...,:3]*=first[...,3:4]/255
                    second[...,:3]*=second[...,3:4]/255
                    differences.append(round(float(np.mean(np.abs(first-second))),4))
                metadata_correct=data['frameCount']==10 and data['frames']==[{'index':i,'x':i%5*512,'y':i//5*512,'width':512,'height':512} for i in range(10)]
                passes_correct=True
                for file in data['passes'].values():
                    pass_image=Image.open(folder/file)
                    passes_correct &= pass_image.size==(2560,1024) and pass_image.mode=='RGBA'
                if data.get('starboardVariant'):
                    for file in [data['starboardVariant']['file'],*data['starboardVariant']['passes'].values()]:
                        pass_image=Image.open(folder/file)
                        passes_correct &= pass_image.size==(2560,1024) and pass_image.mode=='RGBA'
                checks.append({
                    "file":str(path.relative_to(ROOT)).replace("\\","/"),
                    "dimensionsCorrect":sheet.size==(2560,1024),
                    "mode":sheet.mode,"transparent":sheet.mode=="RGBA" and sheet.getchannel("A").getextrema()[0]==0,
                    "frameCount":len(frames),"nonemptyFrames":sum(bool(b) for b in bounds),
                    "distinctFrames":len({hashlib.sha256(f.tobytes()).hexdigest() for f in frames}),
                    "eightPixelGuardClear":all(edge_clean),
                    "loop":data["loop"],"adjacentFrameDifference":differences,
                    "metadataCorrect":metadata_correct,"effectPassesCorrect":bool(passes_correct),
                    "loopSeamComparable":not data['loop'] or differences[-1]<=max(differences[:-1])*1.15,
                    "loopSeamDifference":differences[-1] if data["loop"] else None,
                    "oarCount":sum(layer["name"].startswith("oar-") for layer in rig["layers"]),
                    "bounds":bounds,
                })
                frame=frames[4 if motion=="attack" else 2].resize((224,224),Image.Resampling.LANCZOS)
                x=column*224; y=age_index*258
                draw.rectangle((x,y,x+223,y+22),fill=(36,51,58))
                draw.text((x+7,y+6),label+" / "+category+" / "+motion,fill=(238,242,243))
                overview.paste(frame,(x,y+26),frame)
                column+=1
    overview.save(ROOT/"ship-animation-overview.png")
    # Keep spacious boundaries around the actual game-size samples.
    small=Image.new("RGB",(7*180,len(categories)*330),(23,71,95)); sd=ImageDraw.Draw(small)
    for row,category in enumerate(categories):
        for col,(age,label) in enumerate(zip(AGES,LABELS)):
            sheet=Image.open(ROOT/category/age/"Sailing.png"); sprite=extract(sheet,2)
            sd.text((col*180+8,row*330+8),label+" "+category,fill="white")
            for size,y in [(24,36),(32,73),(64,119),(128,194)]:
                image=sprite.resize((size,size),Image.Resampling.LANCZOS)
                small.paste(image,(col*180+(180-size)//2,row*330+y),image)
                sd.text((col*180+5,row*330+y),str(size),fill=(155,189,205))
    small.save(ROOT/"ship-small-size-review.png")
    # A browser-free animated contact sheet, for sharing the sailing loops.
    animated=[]
    for index in range(10):
        image=Image.new("RGBA",(7*224,len(categories)*250),(23,71,95,255)); d=ImageDraw.Draw(image)
        for row,category in enumerate(categories):
            for col,(age,label) in enumerate(zip(AGES,LABELS)):
                d.text((col*224+9,row*250+9),label+" "+category,fill=(228,236,236))
                sheet=Image.open(ROOT/category/age/"Sailing.png")
                image.alpha_composite(extract(sheet,index).resize((224,224),Image.Resampling.LANCZOS),(col*224,row*250+26))
        animated.append(image)
    animated[0].save(ROOT/"ships-sailing-review.webp",save_all=True,append_images=animated[1:],duration=83,loop=0,lossless=True)
    def valid(c):
        return c['dimensionsCorrect'] and c['transparent'] and c['nonemptyFrames']==10 and c['distinctFrames']>=5 and c['eightPixelGuardClear'] and c['metadataCorrect'] and c['effectPassesCorrect'] and c['loopSeamComparable']
    all_valid=all(valid(c) for c in checks)
    preserved=all(item["unchanged"] for item in original_checks)
    existing_preserved=all(item["unchanged"] for item in existing_checks)
    sources_preserved=all(item["unchanged"] for item in source_checks)
    report={"schemaVersion":1,"shipCount":len(catalog["assets"]),"primaryClipCount":len(checks),"originalsUnchanged":preserved,
            "existingFleetFilesUnchanged":existing_preserved,"existingFleetFileCount":len(existing_checks),"existingFleetFiles":existing_checks,
            "allMasterSourcesUnchanged":sources_preserved,"masterSources":source_checks,
            "originals":original_checks,"assetContractsPassed":all_valid,"clips":checks,
            "visualReview":"Contact sheets and live browser review; no game renderer import or runtime integration claimed."}
    (ROOT/"Ship_Animation_Validation.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"primaryClipCount":len(checks),"originalsUnchanged":preserved,"existingFleetFilesUnchanged":existing_preserved,"allMasterSourcesUnchanged":sources_preserved,"assetContractsPassed":all_valid,
                      "failures":[item['file'] for item in checks if not valid(item)]},indent=2))
    if not all_valid or not preserved or not existing_preserved or not sources_preserved: raise SystemExit(1)


if __name__=="__main__": main()

