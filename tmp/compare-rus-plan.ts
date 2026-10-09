import { readFileSync } from 'node:fs';
import { createRusPackagedRework } from '../src/skirmish/planning/RusPackagedRework';
const p=JSON.parse(readFileSync('skirmish/plans/technology-plan.json','utf8'));
const original=createRusPackagedRework(p.civilizations.find((c:any)=>c.id==='russians-rework'));
const current=p.civilizations.find((c:any)=>c.id===original.id);
for(const field of ['name','notes','ages'])if(JSON.stringify(current[field])!==JSON.stringify((original as any)[field]))console.log('CIV CHANGE',field,JSON.stringify(current[field]));
for(const kind of ['technologies','units']){
 const prior=new Map((original as any)[kind].map((x:any)=>[x.id,x]));
 for(const node of current[kind]){
  const old:any=prior.get(node.id);
  if(!old){console.log('ADDED',kind,JSON.stringify(node));continue;}
  const changes=Object.fromEntries(Object.keys(node).filter(key=>JSON.stringify(node[key])!==JSON.stringify(old[key])).map(key=>[key,{before:old[key],after:node[key]}]));
  if(Object.keys(changes).length)console.log('EDIT',node.id,JSON.stringify(changes));
  prior.delete(node.id);
 }
 for(const [id,node]of prior)console.log('REMOVED',kind,id,JSON.stringify(node));
}

