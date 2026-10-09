from pathlib import Path
import json
p=Path(__file__).parent
f=p/'Deaths-BronzeMace-Nadir-v4-Registration.json'
r=json.loads(f.read_text())
b=r['sheets'][1]
b['pivots']=[{'x':256,'y':218},{'x':258,'y':220},{'x':259,'y':240},{'x':253,'y':240},{'x':245,'y':240},{'x':244,'y':240}]
b['bounds']=[[45,108,468,437],[25,114,477,429],[20,104,465,444],[45,41,505,431],[37,41,492,431],[24,41,493,431]]
b['visibleAlphaFarPixels']=3
b['farPixelAlphaValues']=[21,17,17]
b['flatCorrectionProvenance']='Death-Back-BronzeMace-Nadir-v4-Flat-Correction.json'
r['reviewNote']='Backward fall lower row corrected to completely flat supine body, extended knees, symmetric upward face, visible boot uppers and circular ground-flat shield. Prone corpse uses toes-down ankle pose. Fixed overhead view and smaller grounded heads; artistic acceptance remains user review.'
f.write_text(json.dumps(r,indent=2)+'\n')
g=p/'Death-Back-BronzeMace-Nadir-v4-Generation.json'
j=json.loads(g.read_text());j['finalCorrection']='Death-Back-BronzeMace-Nadir-v4-Flat-Correction.json';j['finalSource']='C:/Users/Damien/.codex/generated_images/01a1186d-c9ae-7993-aebb-e88f9b918c60/exec-be4b7b9e-6197-4f6d-b9c0-ef910fa23609.png';g.write_text(json.dumps(j,indent=2)+'\n')
