import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname } from 'node:path';
const root='out/formation-performance/before';
mkdirSync(root,{recursive:true});
cpSync('src',`${root}/src`,{recursive:true,filter:p=>!extname(p)||['.ts','.json'].includes(extname(p))});
// This performance pass began from this clean revision. Never label a hybrid
// of current simulation and old combat as a before measurement.
const revision='bf1d29bbf6c984b82131689d730b5807760257f3';
for(const path of ['src/skirmish/domain/Battle.ts','src/skirmish/domain/FormationContact.ts','src/skirmish/UnitIndex.ts','src/skirmish/LandingOccupancy.ts',
  'src/skirmish/Simulation.ts','src/skirmish/PhaseSpatialViews.ts','src/skirmish/client/FormationEngagement.ts',
  'src/skirmish/client/troops/TroopActors.ts'])
  writeFileSync(`${root}/${path}`,execFileSync('git',['show',`${revision}:${path}`]));
writeFileSync(`${root}/baseline-revision.txt`,revision);
mkdirSync(`${root}/scripts`,{recursive:true});mkdirSync(`${root}/tests/skirmish/fixtures`,{recursive:true});
for(const path of ['scripts/profileFormationLoad.ts','scripts/profileFormationContinuation.ts','tests/skirmish/fixtures/FormationLoad.ts'])cpSync(path,`${root}/${path}`);
writeFileSync(`${root}/package.json`,'{"type":"module"}');
