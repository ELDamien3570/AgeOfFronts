from pathlib import Path
import json, shutil
source=Path(__file__).resolve().parent
records=json.loads((source/'Animation-Generation.json').read_text(encoding='utf-8-sig'))['records']
for record in records:
    shutil.copy2(record['generatedSource'],source/record['nativeFile'])
print('Registered',len(records),'native sources; all drafts retained.')
