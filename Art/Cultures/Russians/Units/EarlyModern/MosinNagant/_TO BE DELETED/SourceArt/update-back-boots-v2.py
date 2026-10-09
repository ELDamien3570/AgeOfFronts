from pathlib import Path
import json
p=Path(__file__).parent;f=p/'Deaths-v2-Registration.json';r=json.loads(f.read_text());b=r['death-back']
b['pivots']=[{'x':256,'y':146},{'x':258,'y':172},{'x':253,'y':215},{'x':257,'y':250},{'x':256,'y':251},{'x':249,'y':251}]
b['bounds']=[[103,75,480,372],[103,84,448,413],[54,85,438,445],[131,57,418,421],[138,61,407,421],[130,61,399,422]]
b['alphaFarPixels']=0;b['correctionProvenance']='DeathBack-v2-Boot-Upper-Correction.json'
r['notes']='One fixed clip scale from first standing helmet width to110px. No per-frame runtime fitting. Lower row corrected to clearly visible lace/toe uppers, no boot soles; layout repair baked15percent reduction of lower-row body/rifle to preserve exactcell boundaries. Grounded figures therefore smaller than12percent target; source art proportions remain consistent. All native alpha outside3pxedge≤9 backward sheet; lowerrow guards≥57px. Body/floorcenter pivots preserve unfoldingheadtranslation.'
f.write_text(json.dumps(r,indent=2)+'\n')
g=p/'DeathBack-v2-Generation.json';j=json.loads(g.read_text());j['finalCorrection']='DeathBack-v2-Boot-Upper-Correction.json';j['finalSource']='C:/Users/Damien/.codex/generated_images/01a1186d-c9ae-7993-aebb-e88f9b918c60/exec-996bfbae-2f5b-4d6b-833d-0c710a06e034.png';g.write_text(json.dumps(j,indent=2)+'\n')
