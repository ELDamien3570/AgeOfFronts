import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {deserialize,serialize} from 'node:v8';
import {Skirmish} from '../src/skirmish/Simulation';
import {generateMigration} from '../src/skirmish/MigrationMap';
import {SnapshotEncoder,SnapshotDecoder,snapshotTransfers} from '../src/skirmish/SnapshotCodec';

const [input,output,tickText]=process.argv.slice(2),until=Number(tickText);
if(!input||!output||!Number.isSafeInteger(until))throw Error('Usage: advanceLateGameReplay.ts input.v8 output.v8 endingTick');
const saved=deserialize(readFileSync(input)),game=new Skirmish(generateMigration(saved.width,saved.options.seed).map,saved.options);
game.restore(saved);
if(until<game.tick)throw Error('Ending tick precedes checkpoint');
const encoder=new SnapshotEncoder(false,{compactFormationSlots:true,compactTraders:true}),decoder=new SnapshotDecoder();
let publications=0;
const publish=()=>{
  const packet=encoder.encode(game.replicationSource(true),game.tileChanges,game.replicationFacts());
  decoder.decodeLatest(structuredClone(packet,{transfer:snapshotTransfers(packet)}));publications++;
};
publish();
const started=performance.now();
while(game.tick<until&&game.winner===null){
  game.step();
  if(game.tick%20===0)publish();
  if(game.tick%600===0)console.log(JSON.stringify({tick:game.tick,squads:game.squads.length,ships:game.ships.length,heap:process.memoryUsage().heapUsed}));
}
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,serialize(game.checkpoint()));
const result={input,output,initialTick:saved.tick,finalTick:game.tick,winner:game.winner,squads:game.squads.length,ships:game.ships.length,
  publications,elapsedMs:performance.now()-started,limitations:'Stability continuation with publication once per game second; concurrent correctness checks may run. Timing is not a pace benchmark.'};
writeFileSync(output+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
