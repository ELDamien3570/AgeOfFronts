"""Focused validation for the new trader; never rewrites earlier age assets."""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
FOLDER = ROOT/'EarlyMedieval'
module = importlib.util.spec_from_file_location('caravan_checks', ROOT/'validate-classical-animations.py')
checks = importlib.util.module_from_spec(module)
module.loader.exec_module(checks)


def main():
    spec = checks.read(FOLDER/'rig-authoring.json')
    metadata = checks.read(FOLDER/'animations.json')
    rig = checks.caravan.prepare(spec)
    gaits = checks.gait_audit(spec, metadata)
    for gait in gaits:
        gait['age'] = 'EarlyMedieval'
    sheets = checks.sheet_audit(FOLDER, metadata)
    physical = checks.physical_audit(spec, rig)
    physical['articulatedMemberCount'] = len(gaits)
    physical['articulatedLegCount'] = sum(gait['legCount'] for gait in gaits)
    baseline = checks.read(FOLDER/'Review/Preservation-Baseline.json')
    changed = [name for name, digest in baseline.items()
               if hashlib.sha256(Path(name).read_bytes()).hexdigest() != digest]
    source_preserved = checks.caravan.painted.sha(FOLDER/spec['source']) == spec['sourceSha256'] == metadata['sourceSha256']
    passed = (all(g['passed'] for g in gaits) and all(s['passed'] for s in sheets)
              and source_preserved and not changed
              and all(physical[k] for k in ['retainedWagonCargoDrawbarsHubsAndPanniersUnchanged',
                                           'protectedSilhouettesUnchanged', 'treadTextureRolls']))
    report = {'passed': passed, 'age': 'EarlyMedieval', 'gaits': gaits,
              'clips': sheets, 'physicalInvariants': physical,
              'sourceMasterPreserved': source_preserved,
              'previousFilesChecked': len(baseline), 'previousFilesChanged': changed,
              'scope': 'Native gait, sprite, attachment and preservation validation. Browser acceptance and match integration remain separate.'}
    (FOLDER/'Animation_Validation.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'passed': passed, 'clips': len(sheets), 'frames': 20,
                      'articulatedLegs': physical['articulatedLegCount'],
                      'previousFilesChecked': len(baseline)}))
    if not passed:
        print(json.dumps(report, indent=2)); raise SystemExit(1)


if __name__ == '__main__':
    main()
