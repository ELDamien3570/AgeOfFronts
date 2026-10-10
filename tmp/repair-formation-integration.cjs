const fs=require('fs'),cp=require('child_process'),ts=require('../node_modules/typescript');
const path=process.argv[2];let s=cp.execFileSync('git',['show','HEAD:'+path],{encoding:'utf8'});
function replace(a,b){if(!s.includes(a))throw Error('Missing expected edit context: '+a.slice(0,80));s=s.replace(a,b);}
if(path==='src/skirmish/client/main.ts'){
replace('canvas.addEventListener("pointermove", (event) => {\n  const p = localPosition(event);','canvas.addEventListener("pointermove", (event) => {\n  const p = localPosition(event);\n  renderer.hoveredSquadId = renderer.squadAt(p.x, p.y)?.id ?? null;\n  renderer.hoveredAircraftId = renderer.aircraftAt(p.x, p.y, true);');
replace('canvas.addEventListener("pointerleave", () => {','canvas.addEventListener("pointerleave", () => {\n  renderer.hoveredSquadId = renderer.hoveredAircraftId = null;');
}else if(path==='src/skirmish/domain/Expansion.ts'){
replace('missionKind, FLIGHT_RULES','missionKind, FLIGHT_RULES, aircraftRecruitmentCost');
replace('a.state = "outbound";','a.state = "outbound";\n        a.flightBudgetTicks ??= a.fuelTicks;');
replace('enemy.health -= 200;','enemy.health -= 200;\n          if (this.world.volleys.length < 4096) this.world.volleys.push({id:this.world.allocateId(),tick:this.world.tick,squadId:a.id,playerId:a.playerId,definitionId:"fighter-guns",fromX:a.x,fromY:a.y,toX:enemy.x,toY:enemy.y,sourceKind:"aircraft",targetKind:"aircraft",targetId:enemy.id,damage:Math.min(200,health)});');
replace('a.age??base.age??"EarlyModern");continue;}','a.age??base.age??"EarlyModern");a.flightBudgetTicks=a.fuelTicks;continue;}');
replace('if (this.world.owners[this.world.tileOf(squad)] !== player.id) {','if (squad.fighting || this.world.owners[this.world.tileOf(squad)] !== player.id) {');
replace('const cost = {\n        gold: FLIGHT_RULES[kind].gold,\n      },','const cost = aircraftRecruitmentCost(kind),');
}else if(path==='src/skirmish/domain/Battle.ts'){
s='import { afterWeaponShot } from "../content/WeaponCycles";\nimport { predictiveAim } from "../RangedAim";\n'+s;
replace('if (!this.canFire(kind === "mirv" ? warheads : 0)) return false;',`if (!this.canFire(kind === "mirv" ? warheads : 0)) return false;
    const unit = definitionId && UNIT.get(definitionId);
    if (unit && unit.attack.channel === "ranged" && ["StoneAge","BronzeAge","ClassicalAge","EarlyMedieval","LateMedieval"].includes(unit.age) && unit.troopClass) {
      const motion = (target as Squad).locomotion;
      const velocity = motion ? {x:-Math.sin(motion.heading)*motion.speed*20/FIXED*64,y:Math.cos(motion.heading)*motion.speed*20/FIXED*64} : {x:0,y:0};
      const aimed = predictiveAim({x:source.x/FIXED*64,y:source.y/FIXED*64},{x:target.x/FIXED*64,y:target.y/FIXED*64},velocity,(profile.projectile?.speed ?? FIXED)*20/FIXED*64,source.id*65537+this.world.tick,5.2);
      target = {x:Math.round(aimed.point.x/64*FIXED),y:Math.round(aimed.point.y/64*FIXED)};
    }`);
replace('    target: Position,\n  ): void {','    target: Position & {id?:number},\n    damage = 0,\n    melee = false,\n  ): void {');
replace('      toY: target.y,\n    });\n  }\n  private contribution','      toY: target.y,\n      targetId: target.id, damage, melee,\n    });\n  }\n  private contribution');
replace('            damage.add(target.id, squad.playerId, hit);','            damage.add(target.id, squad.playerId, hit);\n            this.volley(squad, target, hit, true);');
replace('          this.world.updateSquad(squad.id, { queuedOrders: [] });',`          this.world.updateSquad(squad.id, { queuedOrders: [] });
          if (definition.age === "Napoleonic" && definition.troopClass === "frontline") this.world.updateSquad(squad.id, {lastAttackTick:tick-1,nextAttackTick:tick+10,reloadStartedTick:undefined,magazineShots:0});`);
s=s.replaceAll('{ nextAttackTick: tick + attackInterval(profile, squad.moved) }','afterWeaponShot(definition, squad.magazineShots ?? 0, tick, attackInterval(profile, squad.moved))');
replace('{ nextAttackTick: this.world.tick + attackInterval(profile, squad.moved) }','afterWeaponShot(this.definition(squad), squad.magazineShots ?? 0, this.world.tick, attackInterval(profile, squad.moved))');
replace('      if (profile.channel === "ranged") this.volley(squad, target);','');
replace('      damage.add(target.id, squad.playerId, hit);\n      this.contribution','      damage.add(target.id, squad.playerId, hit);\n      this.volley(squad, target, hit, profile.channel === "melee");\n      this.contribution');
replace('            p.playerId,\n            hit,\n          );\n          this.contribution',`            p.playerId,
            hit,
          );
          if ("troops" in directHit && this.world.volleys.length < 4096) this.world.volleys.push({id:this.world.allocateId(),squadId:p.sourceId,playerId:p.playerId,definitionId:p.definitionId,tick,fromX:p.fromX,fromY:p.fromY,toX:p.x,toY:p.y,targetId:directHit.id,damage:hit,impact:true});
          this.contribution`);
}else throw Error('Unapproved repair path');
const parsed=ts.createSourceFile(path,s,ts.ScriptTarget.Latest,true);if(parsed.parseDiagnostics.length)throw Error('Repair syntax invalid');
const target='tmp/verified-'+path.split('/').at(-1);fs.writeFileSync(target,s);console.log(JSON.stringify({source:path,target,bytes:Buffer.byteLength(s),syntaxErrors:0}));
