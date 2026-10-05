import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const args=process.argv.slice(2),value=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const out=value("--out","out/hosted-soak"),seconds=value("--seconds","2400");
let occupied=false;
try { await fetch("http://127.0.0.1:9145/healthz"); occupied=true; } catch {}
if(occupied)throw new Error("Soak port is already occupied; existing server was left untouched");
fs.mkdirSync(out,{recursive:true});
const log=fs.openSync(path.join(out,"server.log"),"w");
const server=spawn(process.execPath,["--import","tsx","src/skirmish/multiplayer/server.ts"],{
  env:{...process.env,PORT:"9145",HOST:"127.0.0.1",MULTIPLAYER_DB:path.join(out,"multiplayer.sqlite"),MULTIPLAYER_ORIGINS:"http://127.0.0.1:9145",MULTIPLAYER_MATCH_CAPACITY:"1",MULTIPLAYER_EMPTY_MATCH_GRACE_MS:"1000"},
  stdio:["ignore",log,log],windowsHide:true,
});
let smoke;
const stop=()=>{smoke?.kill();server.kill();};
process.on("SIGTERM",stop);process.on("SIGINT",stop);
try {
  let ready=false;
  for(let i=0;i<100;i++) {
    if(server.exitCode!==null)throw new Error("Soak server exited before readiness");
    try {const r=await fetch("http://127.0.0.1:9145/healthz");if(r.ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!ready)throw new Error("Soak server readiness timed out");
  smoke=spawn(process.execPath,["--import","tsx","scripts/smokeOracleStability.mjs","--url","http://127.0.0.1:9145","--clients",value("--clients","2"),"--binary-clients",value("--binary-clients","0"),"--seconds",seconds,"--map","old-world","--size","1000","--order-interval",value("--order-interval","30"),"--out",path.join(out,"smoke.json"),...(args.includes("--exercise-backpressure")?["--exercise-backpressure"]:[])],{stdio:"inherit",windowsHide:true});
  const code=await new Promise((resolve,reject)=>{smoke.on("error",reject);smoke.on("exit",resolve);});
  if(code!==0)throw new Error("Hosted soak failed; inspect smoke.json and server.log");
} finally {
  server.kill();fs.closeSync(log);
}
