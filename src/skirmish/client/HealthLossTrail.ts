/** Cosmetic trailing health: canonical strength always remains authoritative. */
export class HealthLossTrail {
  private readonly rows = new Map<number, {strength:number;previous:number;tick:number}>();
  clear(){this.rows.clear();}
  update(rows: readonly {id:number;strength:number}[],tick:number){
    const active=new Set<number>();
    for(const row of rows){
      active.add(row.id);const old=this.rows.get(row.id);
      const previous=old && row.strength<old.strength ? Math.max(old.strength,this.value(row.id,tick)) : row.strength;
      this.rows.set(row.id,{strength:row.strength,previous:old && row.strength===old.strength?old.previous:previous,tick:old && row.strength===old.strength?old.tick:tick});
    }
    for(const id of this.rows.keys())if(!active.has(id))this.rows.delete(id);
  }
  value(id:number,tick:number){
    const row=this.rows.get(id);if(!row)return 0;
    const fade=Math.max(0,1-Math.max(0,tick-row.tick-4)/16);
    return row.strength+(row.previous-row.strength)*fade;
  }
}
