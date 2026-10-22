import {describe,expect,it} from 'vitest';
import {Worker} from 'node:worker_threads';
async function compare(messages:unknown[]){
 const worker=new Worker(new URL('../../scripts/oracleSeaTradeComparisonWorker.mjs',import.meta.url));
 const rows:any[]=[];
 try{return await new Promise<any[]>((resolve,reject)=>{
  worker.on('error',reject);worker.on('message',row=>{rows.push(row);if(row.type==='drained')resolve(rows);});
  for(const message of messages)worker.postMessage(message);
  worker.postMessage({type:'drain'});
 });}finally{await worker.terminate();}
}
const snapshot=()=>({tick:20,owners:new Uint8Array([1,2]),squads:[{id:2,x:5,y:6},{id:1,x:3,y:4}],ships:[],buildings:[],traders:[{id:7,waitingReason:'receiver'}],armies:[],players:[]});
describe('isolated Oracle probe comparison',()=>{
 it('compares full state after stable roster and property ordering on a separate worker',async()=>{
  const a=snapshot(),b=snapshot();b.squads=[{y:4,x:3,id:1},{y:6,x:5,id:2}];
  const rows=await compare([{type:'state',key:8,index:0,tick:20,snapshot:a},{type:'state',key:8,index:1,tick:20,snapshot:b}]);
  expect(rows.some(r=>r.type==='disagreement')).toBe(false);
  expect(rows.at(-1)).toMatchObject({type:'drained',processed:2,comparedFrames:1,retainedFrames:1});
 });
 it('retains a real trader-field disagreement instead of excluding it from the hash',async()=>{
  const a=snapshot(),b=snapshot();b.traders[0].waitingReason='route';
  const rows=await compare([{type:'state',key:8,index:0,tick:20,snapshot:a},{type:'state',key:8,index:1,tick:20,snapshot:b}]);
  const failure=rows.find(r=>r.type==='disagreement');expect(failure.key).toBe(8);
  expect(JSON.stringify(failure.states)).toContain('receiver');expect(JSON.stringify(failure.states)).toContain('route');
 });
 it('bounds retained comparison frames and does not pair an evicted publication',async()=>{
  const messages=Array.from({length:34},(_,key)=>({type:'state',key,index:0,tick:key,snapshot:snapshot()}));
  messages.push({type:'state',key:0,index:1,tick:0,snapshot:snapshot()});
  const rows=await compare(messages);expect(rows.at(-1)).toMatchObject({processed:35,comparedFrames:0,retainedFrames:32});
 });
});
