import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { Session } from 'node:inspector';
import { createHash } from 'node:crypto';
import { formationLoad, type FormationWorkload } from '../tests/skirmish/fixtures/FormationLoad';
import { SnapshotEncoder } from '../src/skirmish/SnapshotCodec';

const workload = process.argv[2] as FormationWorkload;
if (!['distributed', 'distributed-battles', 'crowded'].includes(workload)) throw Error('Choose distributed, distributed-battles or crowded');
const label = process.argv[3] ?? 'baseline', ticks = Number(process.argv[4] ?? 80);
const root = 'out/formation-performance'; mkdirSync(root, { recursive: true });
const { game } = formationLoad(workload);
const phases: Record<string, number[]> = {}, times: number[] = [], encoding: number[] = [];
const populations: {tick: number; squads: number; fighting: number; moving: number; volleys: number;searches:number;reused:number;spatialRevision:number}[] = [];
let measuring = false;
game.onPhase = (name, ms) => { if (measuring) (phases[name] ??= []).push(ms); };
const session = new Session(); session.connect();
const post = (name: string) => new Promise<any>((resolve, reject) => session.post(name as any, (e, r) => e ? reject(e) : resolve(r)));
if (process.argv[5] === 'cpu') { await post('Profiler.enable'); await post('Profiler.start'); }
const encoder = new SnapshotEncoder(), began = performance.now();
// Submit a real human order under combat load; report application and first-tick adoption separately.
const source = game.squads.find(s => s.playerId === 1)!;
const target = game.squads.filter(s => s.playerId !== 1).sort((a,b) =>
  (a.x-source.x)**2+(a.y-source.y)**2 - ((b.x-source.x)**2+(b.y-source.y)**2))[0];
const commandAt = performance.now();
const commandError = game.applyCommand({type:'order',playerId:1,squadIds:[source.id],order:{type:'attack',targetId:target.id}});
const commandMs = performance.now() - commandAt;
let adoptionTick: number | undefined;
for (let i = 0; i < ticks; i++) {
  measuring = i >= 10;
  const at = performance.now(); game.step(); if (measuring) times.push(performance.now() - at);
  if (adoptionTick === undefined && source.combatTargetId === target.id) adoptionTick = game.tick;
  populations.push({tick:game.tick,squads:game.squads.length,fighting:game.squads.filter(s=>s.fighting).length,
    moving:game.squads.filter(s=>s.moved).length,volleys:game.volleys.length,
    searches:game.expansion!.battle.acquisitionWork?.searches??0,reused:game.expansion!.battle.acquisitionWork?.reused??0,
    spatialRevision:game.squadFacts().spatialRevision});
  if (measuring && i % 4 === 0) {
    const at = performance.now(); encoder.encode(game.replicationSource(),game.tileChanges,game.replicationFacts());
    encoding.push(performance.now()-at);
  }
  if (performance.now() - began > 120000) break;
}
if (process.argv[5] === 'cpu') { const {profile} = await post('Profiler.stop'); writeFileSync(`${root}/${workload}-${label}.cpuprofile`,JSON.stringify(profile)); }
session.disconnect();
const stats = (xs: number[]) => { const ordered=xs.slice().sort((a,b)=>a-b); return {n:xs.length,
  mean:xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null,p95:ordered[Math.ceil(xs.length*.95)-1] ?? null,max:ordered.at(-1) ?? null}; };
const result = {workload,label,startingSquads:2000,endingSquads:game.squads.length,ticks:game.tick,
  sourceHashes:Object.fromEntries(['Simulation.ts','UnitIndex.ts','LandingOccupancy.ts','domain/Battle.ts','domain/CombatGeometry.ts','domain/CombatActivity.ts','domain/FormationContact.ts']
    .map(path=>[path,createHash('sha256').update(readFileSync(new URL(`../src/skirmish/${path}`,import.meta.url))).digest('hex')])),
  fixtureHash:createHash('sha256').update(readFileSync(new URL('../tests/skirmish/fixtures/FormationLoad.ts',import.meta.url))).digest('hex'),
  simulation:stats(times),encoding:stats(encoding),phases:Object.fromEntries(Object.entries(phases).map(([k,v])=>[k,stats(v)])),
  humanCommand:{error:commandError,applicationMs:commandMs,adoptionTick},populations,
  snapshotHash:createHash('sha256').update(JSON.stringify(game.snapshot())).digest('hex'),
  limitations:'Controlled flat 500x250 Napoleonic core simulation, 14 AI owners with decisions disabled; no browser rendering. Population falls naturally; inspect per-tick engagement counts. Real AI match measured separately.'};
writeFileSync(`${root}/${workload}-${label}.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,populations:undefined}));
