import { buildMigrationLayout } from '../src/skirmish/MigrationLayout';
import { writeFileSync } from 'node:fs';
const cases = [0,1,2,3,4,5,2036862757].map(seed => {
  const sizes = [250,500,1000].map(size => {
    const started = performance.now();
    const {layout} = buildMigrationLayout(size as 250|500|1000, seed);
    return {size, mainlands:layout.mainlands.length, pattern:layout.mainlandPattern,
      islands:layout.islands.length, rivers:layout.rivers.filter(r=>r.kind==='river').length,
      channels:layout.rivers.filter(r=>r.kind==='channel').length, geometryMs:Math.round(performance.now()-started)};
  });
  return {seed,sizes};
});
writeFileSync('outputs/migration-review/Variety-Layouts.json',JSON.stringify(cases,null,2));
console.log(JSON.stringify(cases));
