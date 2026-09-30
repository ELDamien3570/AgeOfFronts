const fs=require('node:fs/promises');
const {sourceKeys}=require('./build-defense.cjs');
(async()=>{const jobs=JSON.parse(await fs.readFile(process.argv[2],'utf8'));for(const job of jobs){try{const result=await sourceKeys(job,job.dimension);console.log(JSON.stringify({key:job.key,clip:job.clip,status:'passed',grid:result.grid,audit:result.audit}));}catch(e){console.log(JSON.stringify({key:job.key,clip:job.clip,status:'failed',error:e.message}));}}})().catch(e=>{console.error(e);process.exitCode=1;});
