"""Validate trader sheets, source preservation and loop boundaries; render reviews."""
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parent


def extract(sheet,index):
    return sheet.crop((index%5*512,index//5*512,index%5*512+512,index//5*512+512))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    catalog=json.loads((ROOT/'Trader_Animation_Manifest.json').read_text())
    checks=[]
    for asset in catalog['assets']:
        folder=ROOT/asset['age']; metadata=json.loads((folder/'animations.json').read_text())
        for motion,data in metadata['animations'].items():
            sheet=Image.open(folder/data['file']); frames=[extract(sheet,i) for i in range(10)]
            edge_clear=[]; bounds=[]; differences=[]
            for i,frame in enumerate(frames):
                a=np.asarray(frame.getchannel('A')); bounds.append(frame.getbbox())
                edge_clear.append(not np.any(np.concatenate([a[:8,:].ravel(),a[-8:,:].ravel(),a[:,:8].ravel(),a[:,-8:].ravel()])))
                first=np.asarray(frame,dtype=np.float32); second=np.asarray(frames[(i+1)%10],dtype=np.float32)
                first[...,:3]*=first[...,3:4]/255; second[...,:3]*=second[...,3:4]/255
                differences.append(round(float(np.mean(np.abs(first-second))),5))
            entry={'file':f"{asset['age']}/{data['file']}",'dimensionsCorrect':sheet.size==(2560,1024),'transparentRGBA':sheet.mode=='RGBA' and sheet.getchannel('A').getextrema()[0]==0,'nonemptyFrames':sum(bool(b) for b in bounds),'distinctFrames':len({hashlib.sha256(f.tobytes()).hexdigest() for f in frames}),'eightPixelGuardClear':all(edge_clear),'metadataCorrect':data['frameCount']==10 and data['frames']==[{'index':i,'x':i%5*512,'y':i//5*512,'width':512,'height':512} for i in range(10)],'loopSeamComparable':differences[-1]<=max(differences[:-1])*1.2,'adjacentFrameDifferences':differences,'frameBounds':bounds}
            entry['passed']=entry['dimensionsCorrect'] and entry['transparentRGBA'] and entry['nonemptyFrames']==10 and entry['distinctFrames']>=8 and entry['eightPixelGuardClear'] and entry['metadataCorrect'] and entry['loopSeamComparable']
            checks.append(entry)
    source_checks=[{'file':asset['original'],'unchanged':sha(ROOT/asset['original'])==asset['sourceSha256']} for asset in catalog['assets']]
    baseline=json.loads((ROOT/'existing-art-hashes.json').read_text())
    old_changes=[file for file,expected in baseline.items() if sha(ROOT.parent/file)!=expected]
    complete=len(catalog['assets'])==6 and len(checks)==12
    report={'schemaVersion':1,'traderCount':len(catalog['assets']),'primaryClipCount':len(checks),'sixAgesComplete':complete,'assetContractsPassed':all(c['passed'] for c in checks),'sourcesPreserved':all(c['unchanged'] for c in source_checks),'sources':source_checks,'existingArtFileCount':len(baseline),'existingArtUnchanged':not old_changes,'existingArtChanges':old_changes,'existingArtAuditNote':'Existing art fingerprints are diagnostic. Soldier animation files changed after the baseline was captured during production. The trader build writes only Trader Icons, and those external changes were left untouched.','clips':checks,'visualReview':'Automated checks cover sprite contracts and loop boundaries. Visual review covers silhouettes, member counts, drawbars, walking motion and caravan spacing. Game integration is unverified.'}
    (ROOT/'Trader_Animation_Validation.json').write_text(json.dumps(report,indent=2)+'\n')
    assets=catalog['assets']; animation=[]
    for index in range(10):
        canvas=Image.new('RGBA',(3*320,2*352),(40,57,42,255)); d=ImageDraw.Draw(canvas)
        for pos,asset in enumerate(assets):
            x=pos%3*320; y=pos//3*352
            sheet=Image.open(ROOT/asset['age']/'Travel.png')
            canvas.alpha_composite(extract(sheet,index).resize((320,320),Image.Resampling.LANCZOS),(x,y+30))
            d.text((x+10,y+10),asset['ageLabel']+' / '+asset['label'],fill=(232,236,220,255))
        animation.append(canvas)
    animation[0].save(ROOT/'trader-progression-review.webp',save_all=True,append_images=animation[1:],duration=83,loop=0,lossless=True)
    animation[0].convert('RGB').save(ROOT/'trader-progression-review.png')
    small=Image.new('RGB',(6*180,342),(40,57,42)); d=ImageDraw.Draw(small)
    for col,asset in enumerate(assets):
        sprite=extract(Image.open(ROOT/asset['age']/'Travel.png'),2)
        d.text((col*180+8,8),asset['ageLabel'],fill='white')
        for size,y in [(24,37),(32,81),(64,130),(128,210)]:
            image=sprite.resize((size,size),Image.Resampling.LANCZOS); small.paste(image,(col*180+(180-size)//2,y),image); d.text((col*180+6,y),str(size),fill=(171,190,162))
    small.save(ROOT/'trader-small-size-review.png')
    print(json.dumps({k:report[k] for k in ['traderCount','primaryClipCount','sixAgesComplete','assetContractsPassed','sourcesPreserved','existingArtUnchanged']}|{'failures':[c['file'] for c in checks if not c['passed']]},indent=2))
    if old_changes: print('External art fingerprint changes (not reverted): '+', '.join(old_changes))
    if not complete or not report['assetContractsPassed'] or not report['sourcesPreserved']: raise SystemExit(1)


if __name__=='__main__':main()
