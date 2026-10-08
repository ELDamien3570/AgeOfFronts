"""Register the authored fleet once; retain originals and never replace existing masters."""
import hashlib
import json
import shutil
from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
REVIEW = ROOT/'Review'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
def save(path, data):
    path.write_text(json.dumps(data, indent=2)+'\n', encoding='utf-8')

def main():
    REVIEW.mkdir(exist_ok=True)
    data = json.loads((ROOT/'Fleet-Generation-Requests.json').read_text(encoding='utf-8'))
    catalog_path = ROOT/'Ship_Animation_Manifest.json'
    catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
    original_assets = json.loads(json.dumps(catalog['assets']))
    keys = {(a['age'],a['category']) for a in original_assets}
    if any((item['row'][0],item['row'][2]) in keys for item in data):
        raise ValueError('New roster overlaps existing catalog; refusing to overwrite artwork')
    baseline = {str(p):sha(p) for base in [REPO/'Art/Ship Icons', ROOT,
                REPO/'Art/Cultures/Russians/Traders', REPO/'Art/Cultures/Russians/Aircraft']
                for p in base.rglob('*') if p.is_file() and p.suffix.lower() in ['.png','.webp','.gif']}
    save(REVIEW/'Fleet-Preservation-Baseline.json', baseline)
    plan_path = REPO/'skirmish/plans/technology-plan.json'
    plan = json.loads(plan_path.read_text(encoding='utf-8'))
    civ = next(c for c in plan['civilizations'] if c['id']=='russians-rework')
    tech = {n['id']:n for n in civ['technologies']}
    labels = {a['id']:a['name'] for a in civ['ages']}
    records = []
    for item in data:
        age,role,category,label,design,unlock = item['row']
        assert unlock in tech
        folder = ROOT/age/role
        raw = folder/'SourceArt'/f'{role}_Russian_{age}_Generated_v1.png'
        path = folder/'SourceArt'/f'{role}_Russian_{age}_v1.png'
        if raw.exists() or path.exists():
            raise ValueError('Versioned output already exists: '+str(path))
        raw.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(item['path'],raw)
        im = Image.open(raw).convert('RGBA')
        bounds = im.getchannel('A').getbbox()
        assert bounds
        crop = im.crop(bounds)
        factor = 1080/max(crop.size)
        size = (round(crop.width*factor),round(crop.height*factor))
        offset = ((1254-size[0])//2,(1254-size[1])//2)
        master = Image.new('RGBA',(1254,1254),(0,0,0,0))
        master.alpha_composite(crop.resize(size,Image.Resampling.LANCZOS),offset)
        master.save(path,optimize=True)
        source = path.relative_to(ROOT).as_posix()
        save(folder/'Generation-Manifest.json', {
            'schemaVersion':1,'cultureId':'russian','age':age,'role':role,'label':label,
            'generator':'built-in imagegen','prompt':item['prompt'],
            'generatedOriginal':item['path'],'retainedOriginal':raw.relative_to(folder).as_posix(),
            'rawSha256':sha(raw),'rawSize':list(im.size),'source':path.relative_to(folder).as_posix(),
            'sourceSha256':sha(path),'registration':{'alphaBounds':list(bounds),
            'uniformScale':factor,'offset':list(offset),'canvas':[1254,1254]},
            'conversion':'Uniform alpha-bounds fit, Lanczos resampling and transparent padding only; original retained unchanged.',
            'technologyPlan':'skirmish/plans/technology-plan.json','civilizationId':'russians-rework',
            'unlockTechnology':unlock,'unlockName':tech[unlock]['name'],
            'visualApproval':'pending','animationApproval':'pending',
            'integrationStatus':'art review only; no gameplay or match renderer changes',
            'historicalScope':'Era-inspired role design, not an exact reconstruction of a named vessel'})
        catalog['assets'].append({'age':age,'ageLabel':labels[age],'category':category,'label':label,
            'poster':source,'description':label+' - '+tech[unlock]['name'],
            'status':'static-master-awaiting-approval','clips':[],'sourceSha256':sha(path),'technology':unlock})
        records.append({'age':age,'role':role,'label':label,'unlock':unlock,'poster':source})
        alpha = np.asarray(master)[...,3]
        assert not alpha[:64].any() and not alpha[-64:].any() and not alpha[:,:64].any() and not alpha[:,-64:].any()
        (folder/'Review').mkdir(exist_ok=True)
        for extent in [48,64,128]:
            master.resize((extent,extent),Image.Resampling.LANCZOS).save(folder/'Review'/f'Frame-{extent}px.png')
    assert catalog['assets'][:len(original_assets)] == original_assets
    catalog['shipCount'] = len(catalog['assets'])
    catalog['clipCount'] = sum(len(a['clips']) for a in catalog['assets'])
    catalog['artDirection'] = 'Russian era-inspired naval roles across eight ages; overhead combat, passenger and freight silhouettes'
    catalog['status'] = 'Approved animated early-age boats plus 17 static fleet masters awaiting approval'
    save(catalog_path,catalog)
    save(REVIEW/'Tech-Tree-Fleet-Coverage.json', {'schemaVersion':1,'civilizationId':'russians-rework',
        'planSha256':sha(plan_path),'createdMasters':records,'existingAnimatedVessels':len(original_assets),
        'totalVessels':len(catalog['assets']),
        'upgradePolicy':'Research upgrades do not add base sprites. Advanced Submarine Systems develops engineering; Nuclear Submarines supplies the Modern submarine master.',
        'visualApproval':'pending','animationApproval':'pending'})
    changed = [p for p,h in baseline.items() if sha(Path(p)) != h]
    assert not changed,changed
    validation = {'passed':True,'newMasters':len(records),'transparentGuard':64,'dimensions':[1254,1254],
        'previousImagesPreserved':len(baseline),'previousCatalogEntriesPreserved':True,
        'allUnlockIdsExist':True,'artisticAcceptance':'pending',
        'browserVisualQA':'unavailable; local HTTP and static verification only'}
    save(REVIEW/'Fleet-Master-Validation.json',validation)
    for age in dict.fromkeys(r['age'] for r in records):
        assets = [a for a in catalog['assets'] if a['age']==age]
        proof = Image.new('RGB',(len(assets)*300,480),(32,66,76))
        draw = ImageDraw.Draw(proof)
        for i,a in enumerate(assets):
            im = Image.open(ROOT/a['poster']).convert('RGBA')
            frame = im.resize((280,280),Image.Resampling.LANCZOS)
            proof.paste(frame,(i*300+10,40),frame)
            draw.text((i*300+10,10),a['label'],fill=(241,234,215))
            for n,s in enumerate([48,64,128]):
                f = im.resize((s,s),Image.Resampling.LANCZOS)
                x = i*300+10+n*90
                proof.paste(f,(x,340),f)
                draw.text((x,470),str(s)+' px',fill=(241,234,215))
        proof.save(REVIEW/(age+'-Fleet.png'))
    print(json.dumps(validation))

if __name__ == '__main__':
    main()
