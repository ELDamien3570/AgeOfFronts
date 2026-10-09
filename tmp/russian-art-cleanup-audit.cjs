const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const workspace=process.cwd(),root=path.resolve('Art/Cultures/Russians'),archiveName='_TO BE DELETED';
const files=new Map(),keep=new Map(),queue=[],unresolved=[],normalized=new Map(),edits=[];
const slash=p=>p.replaceAll('\\','/');
const inside=p=>p===root||p.startsWith(root+path.sep);
async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){if(e.name===archiveName)continue;const p=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('Symlink requires review: '+p);if(e.isDirectory())await walk(p);else if(e.isFile())files.set(p,{size:(await fs.stat(p)).size});}}
function owner(p){const parts=path.relative(root,p).split(path.sep);let depth=1;if(['Units','Buildings','Ships','Aircraft','Siege'].includes(parts[0])&&parts.length>=4&&!['Animations','Review'].includes(parts[1]))depth=3;else if(parts[0]==='Traders'&&parts.length>=3&& !['Shared','Review'].includes(parts[1]))depth=2;else if(parts.length>=3&&['Units','Buildings','Ships','Aircraft','Siege'].includes(parts[0])&&!['Animations','Review'].includes(parts[1]))depth=2;return path.join(root,...parts.slice(0,depth));}
function protect(p,reason){p=path.resolve(p);if(files.has(p)&&!keep.has(p)){keep.set(p,reason);queue.push(p);}}
function resolve(ref,from){if(typeof ref!=='string')return null;ref=ref.split(/[?#]/)[0];if(!/\.(png|jpe?g|webp|gif|svg|json|html|js|mjs|cjs|md|py)$/i.test(ref)||/^(https?:|data:|blob:)/i.test(ref))return null;ref=ref.replaceAll('\\','/');const candidates=[];if(path.isAbsolute(ref))candidates.push(ref);if(ref.startsWith('/Art/'))candidates.push(path.join(workspace,ref.slice(1)));if(ref.startsWith('Art/'))candidates.push(path.join(workspace,ref));let dir=path.dirname(from);for(let n=0;n<5;n++){candidates.push(path.resolve(dir,ref));dir=path.dirname(dir);}for(const p of candidates){if(files.has(p))return p;}return null;}
function refs(value,from,key=''){if(typeof value==='string'){if(/previous|before|preserv|original|baseline|backup|approvedIdle/i.test(key))return;const p=resolve(value,from);if(p)protect(p,'dependency of '+slash(path.relative(root,from)));}else if(Array.isArray(value)){for(const v of value)refs(v,from,key);}else if(value&&typeof value==='object'){for(const[k,v]of Object.entries(value))refs(v,from,k);}}
const catalogNames=['Units/manifest.json','Buildings/manifest.json','Aircraft/manifest.json','Siege/manifest.json','Ships/Ship_Animation_Manifest.json','Traders/Trader_Animation_Manifest.json','Buildings/Animations/manifest.json'];
(async()=>{
 await walk(root);
 for(const [p]of files){if(path.basename(p)!=='Actor_Review.html')continue;const metadata=path.join(path.dirname(p),'animations.json');if(!files.has(metadata))continue;const m=JSON.parse(await fs.readFile(metadata,'utf8'));const idle=m.animations?.find(a=>a.id==='idle');if(!idle)continue;const original=await fs.readFile(p,'utf8');const match=original.match(/(<a\b[^>]*id=["']sheet["'][^>]*href=["'])([^"']+)(["'])/);if(match&&match[2]!==idle.file){const updated=original.replace(match[0],match[1]+idle.file+match[3]);normalized.set(p,updated);edits.push({file:slash(path.relative(root,p)),beforeHash:crypto.createHash('sha256').update(original).digest('hex'),newContent:updated,reason:'Point initial sheet link at the selected idle animation'});}}
 const unitManifest=JSON.parse(await fs.readFile(path.join(root,'Units/manifest.json'),'utf8'));
 const selectedUnits=new Map();for(const u of unitManifest.units){const p=path.join(root,'Units',u.metadata);selectedUnits.set(owner(p),p);}
 for(const rel of catalogNames)protect(path.join(root,rel),'current catalog');
 for(const[p]of files){const rel=slash(path.relative(root,p)),name=path.basename(p),base=owner(p);
  if(rel.includes('/FactionMasks/')||rel.includes('/FactionMaskPrototype/'))continue;
  if(name==='animations.json'){
   if(rel.startsWith('Units/')){if(selectedUnits.has(base)){if(p===selectedUnits.get(base))protect(p,'selected top-down troop metadata');}else if(path.dirname(p)===base)protect(p,'current standalone troop metadata');}
   else if(!/SourceArt|TopDownReview|Formation|Archive|Before|Previous|Review\//i.test(rel))protect(p,'current asset animation metadata');
  }
  if(name==='rig.json'&&!/SourceArt|Review|Before|Previous/i.test(rel))protect(p,'current animation rig');
  if(/\.html$/i.test(name)&&path.relative(root,path.dirname(p)).split(path.sep).length<=1)protect(p,'category review entry point');
  if(rel==='Buildings/Animations/Review.html')protect(p,'building animation review entry point');
  if(name==='animation-rigs.json')protect(p,'current aircraft rig definitions');
 }
 // Direct compile-time imports of formation/layout data must remain in place.
 const codeDirs=[path.join(workspace,'src')];async function scanCode(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await scanCode(p);else if(/\.(ts|tsx|js|mjs|cjs)$/.test(e.name)){const text=normalized.get(p)||await fs.readFile(p,'utf8');for(const m of text.matchAll(/["'`]([^"'`\n]*Cultures\/Russians[^"'`\n]*)["'`]/g)){const target=resolve(m[1],p);if(target)protect(target,'direct source-code dependency: '+slash(path.relative(workspace,p)));}}}}
 for(const dir of codeDirs)await scanCode(dir);
 // Keep current per-asset review pages, plus only their functional dependencies.
 for(const[p]of files){const name=path.basename(p),base=owner(p);if(name==='Actor_Review.html'&&files.has(path.join(path.dirname(p),'animations.json'))){if(selectedUnits.has(base)){if(path.dirname(p)===path.dirname(selectedUnits.get(base)))protect(p,'selected top-down actor review');}else if(path.dirname(p)===base)protect(p,'current standalone actor review');}}
 async function drain(){while(queue.length){const p=queue.shift(),ext=path.extname(p);let text;try{text=normalized.get(p)||await fs.readFile(p,'utf8');}catch{continue;}if(ext==='.json'&&!keep.get(p).startsWith('direct source-code dependency')&&!/Generation|Validation|Before|Previous|Browser|Approval|Composition|Baseline|Equipment/i.test(path.basename(p))){try{refs(JSON.parse(text),p);}catch{throw Error('Invalid active JSON: '+p);}}
  if(['.html','.js','.mjs'].includes(ext)){for(const m of text.matchAll(/["'`]([^"'`\n]+\.(?:png|jpe?g|webp|gif|svg|json|html|js|mjs|md))(?:\?[^"'`]*)?["'`]/gi)){const target=resolve(m[1],p);if(!target)continue;if(/Generation|Validation|Before|Previous|Browser|Baseline|preserved/i.test(path.basename(target)))continue;
   if(ext==='.html'&&/\.html$/i.test(target)&&owner(target)!==owner(p))continue; // optional historical cross-links will be relocated.
   protect(target,'live review dependency of '+slash(path.relative(root,p)));
  }}
 }
 }
 await drain();
 // A compile-time formation-layout import does not consume authoring sheets.
 // Live formation review pages do, so retain their explicit source closure.
 for(const [p]of keep){if(path.basename(p)==='Formation_Review.html'){const metadata=path.join(path.dirname(p),'formation.json');if(files.has(metadata))refs(JSON.parse(await fs.readFile(metadata,'utf8')),metadata);}}
 await drain();
 // The selected top-down Javelinist's latest approved static master remains valid.
 protect(path.join(root,'Units/StoneAge/Javelinist/TopDownReview/Idle-TopDown-v3.png'),'latest approved top-down static master, documented in current README');
 await drain();
 // Current selected rig source references may be nested; all selected animation frames are kept above.
 const moves=[];for(const[p,info]of files){if(keep.has(p))continue;const base=owner(p),dest=path.resolve(base,archiveName,path.relative(base,p));if(!inside(base)||!inside(p)||!inside(dest)||!dest.startsWith(base+path.sep+archiveName+path.sep))throw Error('Archive escapes intended asset folder');try{await fs.access(dest);throw Error('Archive collision: '+dest);}catch(e){if(e.code!=='ENOENT')throw e;}
  moves.push({from:slash(path.relative(root,p)),to:slash(path.relative(root,dest)),size:info.size,sha256:crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex'),reason:/\.(py|cjs|mjs|pyc)$/.test(p)?'working/validation script':/SourceArt|Generation|Validation|Before|Review|Browser|Preview/i.test(p)?'generation, history or review working material':'not selected by current catalogs, animations or live dependency closure'});
 }
 const plan={root,created:new Date().toISOString(),edits:edits.filter(e=>keep.has(path.join(root,e.file))),keep:[...keep].map(([p,reason])=>({file:slash(path.relative(root,p)),reason})),moves,selectedTroopMetadata:[...selectedUnits.values()].map(p=>slash(path.relative(root,p)))};
 await fs.writeFile(path.join(workspace,'tmp/russian-art-cleanup-plan.json'),JSON.stringify(plan,null,2)+'\n');
 console.log(JSON.stringify({files:files.size,kept:keep.size,moved:moves.length,bytes:moves.reduce((s,m)=>s+m.size,0),assetFolders:new Set(moves.map(m=>m.to.split('/'+archiveName+'/')[0])).size,selectedTopDown:[...selectedUnits.values()].filter(p=>p.includes('TopDownReview')).map(p=>slash(path.relative(root,p))),keepScripts:[...keep.keys()].filter(p=>/\.(py|cjs|mjs|js)$/.test(p)).map(p=>slash(path.relative(root,p)))},null,2));
 console.log('Selected unit kept counts:',JSON.stringify([...selectedUnits.keys()].map(p=>({folder:slash(path.relative(root,p)),kept:[...keep.keys()].filter(k=>owner(k)===p).length,moved:moves.filter(m=>owner(path.join(root,m.from))===p).length})).filter(x=>x.kept<10)));
})().catch(e=>{console.error(e);process.exitCode=1});

