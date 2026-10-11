import {readFileSync,writeFileSync} from 'node:fs';
const path=process.argv[2],profile=JSON.parse(readFileSync(path,'utf8'));
const nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map();
for(const n of nodes.values())for(const child of n.children??[])parents.set(child,n.id);
const self=new Map(),inclusive=new Map(),modules=new Map();let total=0;
const key=n=>`${n.callFrame.functionName||'(anonymous)'} | ${n.callFrame.url.replace(/^.*AgeOfFronts[\\/]AgeOfFronts[\\/]/,'')} : ${n.callFrame.lineNumber+1}`;
for(let i=0;i<profile.samples.length;i++){
 const ms=(profile.timeDeltas[i]??1000)/1000;total+=ms;let id=profile.samples[i];
 const n=nodes.get(id);self.set(key(n),(self.get(key(n))??0)+ms);
 const module=n.callFrame.url.replace(/^.*AgeOfFronts[\\/]AgeOfFronts[\\/]/,'')||n.callFrame.functionName;
 modules.set(module,(modules.get(module)??0)+ms);
 const seen=new Set();while(id){const n=nodes.get(id),k=key(n);if(!seen.has(k)){inclusive.set(k,(inclusive.get(k)??0)+ms);seen.add(k);}id=parents.get(id);}
}
const rank=map=>[...map].sort((a,b)=>b[1]-a[1]).slice(0,45).map(([functionLocation,ms])=>({functionLocation,ms,pct:100*ms/total}));
const result={totalMs:total,self:rank(self),inclusive:rank(inclusive),modules:rank(modules)};
writeFileSync(path.replace('.cpuprofile','-cpu-summary.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
