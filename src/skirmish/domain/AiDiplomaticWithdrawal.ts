import {TICKS_PER_SECOND,type Squad} from '../Protocol';
type Withdrawal=NonNullable<Squad['aiWithdrawal']>;
export function validateAiWithdrawal(state:Squad['aiWithdrawal'],tick?:number):void {
  if(state===undefined)return;
  if(!state||!Number.isSafeInteger(state.owner)||state.owner<1||state.owner>=255||!Number.isSafeInteger(state.since)||state.since<0||
    !Number.isSafeInteger(state.deadline)||state.deadline!==state.since+30*TICKS_PER_SECOND||!['withdrawing','recovery'].includes(state.phase)||tick!==undefined&&(state.since>tick||state.phase==='recovery'&&state.deadline>tick))throw Error('Invalid diplomatic withdrawal');
}
export interface WithdrawalPorts {
  tick:number;
  owner(squad:Squad):number;
  ai(playerId:number):boolean;
  allowed(squad:Squad):boolean;
  set(squad:Squad,state:Withdrawal|undefined):void;
  begin(squad:Squad):boolean;
  recover(squad:Squad):void;
  release(squad:Squad):void;
}
/** One obligation per unit, persisted on the authoritative squad record.
 * A changed border does not declare war. Failed withdrawal does not reset its
 * deadline, abandon its movement owner, or manufacture another invasion. */
export function stepDiplomaticWithdrawal(squads:readonly Squad[],ports:WithdrawalPorts):void {
  for(const squad of squads){
    const state=squad.aiWithdrawal;
    if(!ports.ai(squad.playerId)||squad.troops<=0||ports.allowed(squad)){
      if(state){ports.release(squad);ports.set(squad,undefined);}continue;
    }
    if(squad.embarkedOn!==null||squad.afloat)continue;
    if(!state){
      if(squad.refit||squad.manpower?.enlargement||squad.charge)continue;
      // Claim before installing the obligation; other higher-priority domains
      // retain their established ownership until they can hand it over.
      if(!ports.begin(squad))continue;
      ports.set(squad,{owner:ports.owner(squad),since:ports.tick,deadline:ports.tick+30*TICKS_PER_SECOND,phase:'withdrawing'});
    }else if(state.phase==='withdrawing'&&ports.tick>=state.deadline){
      ports.recover(squad);ports.set(squad,{...state,phase:'recovery'});
    }else if(state.owner!==ports.owner(squad)){
      ports.set(squad,{...state,owner:ports.owner(squad)});
    }
  }
}
