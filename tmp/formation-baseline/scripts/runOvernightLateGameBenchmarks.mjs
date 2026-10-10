import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const args=process.argv.slice(2),value=(name,fallback)=>{const at=args.indexOf(name);return at<0?fallback:args[at+1];};
const root=value("--out","out/overnight-1000");
const baseline=value("--baseline",path.join(root,"seed42"));
fs.mkdirSync(root,{recursive:true});
const ledger=path.join(root,"experiments.jsonl");
const log=row=>fs.appendFileSync(ledger,JSON.stringify({...row,time:new Date().toISOString()})+"\n");
const deadline=Date.now()+3*60*60*1000;
log({event:"waiting-for-baseline",baseline});
if(args.includes("--recover-transport-failure")) {
  // First preserve a checkpoint at the unmodified domain failure, then run
  // the explicitly labelled diagnostic revalidation prototype to completion.
  for(const [label,filter] of [["transport-failure-reproduction",false],["seed42-filtered",true]]) {
    const out=path.join(root,label);fs.mkdirSync(out,{recursive:true});
    const stdout=fs.openSync(path.join(out,"console.log"),"w");
    const command=["--import","tsx","scripts/profileSkirmishStability.mjs","--restore",path.join(root,"seed42","checkpoint-24000.v8"),"--map","old-world","--size","1000","--humans","2","--all-ai","--inspect-churn","--ticks",filter?"72000":"36000","--profile-at",filter?"48000":"24000","--max-seconds","7200","--out",out,...(filter?["--filter-stale-transport-candidates"]:[])];
    log({event:"experiment-started",experiment:label});
    const child=spawn(process.execPath,command,{stdio:["ignore",stdout,stdout],windowsHide:true});
    try{const code=await new Promise((resolve,reject)=>{child.on("error",reject);child.on("exit",resolve);});log({event:"experiment-finished",experiment:label,code});if(filter&&code!==0)throw new Error("Filtered diagnostic baseline failed; inspect failure.json");}finally{fs.closeSync(stdout);}
  }
}
while(!fs.existsSync(path.join(baseline,"summary.json"))){
  if(Date.now()>deadline)throw new Error("Baseline did not finish within three hours");
  await new Promise(resolve=>setTimeout(resolve,30000));
}
const checkpoint=path.join(baseline,"checkpoint-60000.v8");
if(!fs.existsSync(checkpoint))throw new Error("Baseline ended before the 50-minute comparison checkpoint");
for(const experiment of ["baseline","no-trade-planning","no-armies","no-ai-construction","worker-encoding"]){
  const out=path.join(root,`compare-${experiment}`);
  fs.mkdirSync(out,{recursive:true});
  const stdout=fs.openSync(path.join(out,"console.log"),"w");
  log({event:"experiment-started",experiment,checkpoint});
  const command=["--import","tsx","scripts/profileSkirmishStability.mjs","--restore",checkpoint,
    "--map","old-world","--size","1000","--humans","2","--all-ai","--inspect-churn",
    "--ticks","64800","--profile-at","60000","--max-seconds","900","--out",out,
    ...(args.includes("--recover-transport-failure")?["--filter-stale-transport-candidates"]:[]),
    ...(experiment==="worker-encoding"?["--worker-encoding"]:["--experiment",experiment])];
  const child=spawn(process.execPath,command,{stdio:["ignore",stdout,stdout],windowsHide:true});
  try {
    const code=await new Promise((resolve,reject)=>{child.on("error",reject);child.on("exit",resolve);});
    log({event:"experiment-finished",experiment,code});
    if(code!==0)throw new Error(`Experiment ${experiment} failed; inspect its console.log`);
  }finally{fs.closeSync(stdout);}
}
for(const armies of [false,true]){
  const experiment=armies?"two-army-orders":"loose-squad-orders",out=path.join(root,`${experiment}.json`);
  log({event:"experiment-started",experiment,checkpoint});
  const command=["--import","tsx","scripts/profileV11LateLatency.mjs","--restore",checkpoint,"--map","old-world","--size","1000","--count","100","--out",out,...(armies?["--armies"]:[])];
  const stdout=fs.openSync(path.join(root,`${experiment}.log`),"w");
  const child=spawn(process.execPath,command,{stdio:["ignore",stdout,stdout],windowsHide:true});
  try{const code=await new Promise((resolve,reject)=>{child.on("error",reject);child.on("exit",resolve);});log({event:"experiment-finished",experiment,code});if(code!==0)throw new Error(`Experiment ${experiment} failed`);}finally{fs.closeSync(stdout);}
}
log({event:"comparisons-complete"});
