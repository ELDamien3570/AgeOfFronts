import type {Command} from '../Protocol';
import type {EmpireViewModel} from './EmpireViewModel';

/** Offers are authoritative; this view only presents them and submits decisions. */
export class PeaceOfferView {
  private readonly element=document.createElement('aside');
  private readonly cards=new Map<number,HTMLElement>();
  private vm?:EmpireViewModel;
  private muted=false;
  constructor(main:Element,private readonly command:(command:Command)=>void){
    this.element.className='alliance-renewals peace-offers';this.element.setAttribute('aria-label','Peace offers');this.element.hidden=true;main.append(this.element);
    const label=document.createElement('label');label.className='peace-offer-mute hud-surface';
    const mute=document.createElement('input');mute.type='checkbox';
    label.append(mute,document.createTextNode('Ignore peace popups for this match'));this.element.append(label);
    mute.addEventListener('change',()=>{this.muted=mute.checked;if(this.vm)this.update(this.vm);});
    this.element.addEventListener('click',event=>{
      const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button[data-peace]');
      if(!button||!this.vm)return;
      const offer=this.vm.incoming.find(o=>o.kind==='peace'&&o.id===Number(button.dataset.offer));if(!offer)return;
      this.command({type:'alliance',playerId:this.vm.playerId,otherId:offer.proposer,action:button.dataset.peace==='accept'?'accept-peace':'reject-peace'});
    });
  }
  reset(){this.vm=undefined;this.muted=false;this.cards.clear();this.element.querySelectorAll('section').forEach(card=>card.remove());this.element.querySelector('input')!.checked=false;this.element.hidden=true;}
  update(vm:EmpireViewModel){
    this.vm=vm;const offers=this.muted?[]:vm.incoming.filter(o=>o.kind==='peace'&&o.expiresTick>vm.state.tick),ids=new Set(offers.map(o=>o.id));
    for(const [id,card] of this.cards)if(!ids.has(id)){card.remove();this.cards.delete(id);}
    for(const offer of offers){let card=this.cards.get(offer.id);if(!card){
      card=document.createElement('section');card.className='peace-offer hud-surface';
      const title=document.createElement('strong');title.textContent=(vm.state.players.find(p=>p.id===offer.proposer)?.name??'Faction')+' offers peace';card.append(title);
      const detail=document.createElement('span');detail.textContent='Ends war and raids. One minute of protected peace.';card.append(detail);
      for(const [action,label] of [['accept','Accept peace'],['reject','Reject peace']]){const button=document.createElement('button');button.type='button';button.dataset.peace=action;button.dataset.offer=String(offer.id);button.textContent=label;card.append(button);}
      this.cards.set(offer.id,card);this.element.append(card);
    }}this.element.hidden=!offers.length;
  }
}
