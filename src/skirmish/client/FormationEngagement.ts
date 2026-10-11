import { formationMovementProfile } from "../FormationMovementProfile";
import { OpponentAttention } from './OpponentAttention';
import { nearestContactPoint } from '../domain/ContactFront';
import { ReservePress } from './ReservePress';
import type { SoldierSlot } from "./FormationSoldierMotion";

type Point = { x: number; y: number };
export interface EngagementOpponents {
  center: Point;
  soldiers: readonly (Point & { id: string })[];
  boundary?:readonly Point[];
}
export interface EngagementIntent {
  active: boolean;
  charging: boolean;
  mounted?: boolean;
  crowdPress?: boolean;
  ranged: boolean;
  square: boolean;
  travelHeading: number;
  /** Shared canonical poses already own bounded squad turning. */
  canonicalHeading?: boolean;
  /** World units; optional for legacy preview choreography. */
  meleeReach?: number;
  contactAdvance?: number;
  reformInPlace?: boolean;
  travelling?: boolean;
  footprint: number;
  layout?: string;
  target?: Point;
  threats?: readonly Point[];
  /** Visible opponent poses only; no individual combat or damage entities. */
  opponents?: readonly EngagementOpponents[];
}
const delta = (a: number, b: number) =>
  Math.atan2(Math.sin(b - a), Math.cos(b - a));
const zero = { x: 0, y: 0 };
const opponentIndexes=new WeakMap<EngagementOpponents,OpponentAttention>();

/** Presentation only: stable footprint, independent attention and reusable reserve-step tracks. */
export class FormationEngagement {
  private heading?: number;
  private previous?: number;
  private sector?: number;
  private candidate?: { sector: number; since: number };
  private readonly reservePress:ReservePress;
  private readonly attention = new Map<number, string>();
  private readonly contactOffsets = new Map<number,Point>();
  constructor(variant = 0) {this.reservePress=new ReservePress(variant);}

  /** Coordinate change only; a new facing must not rotate existing footwork. */
  rebaseFrame(angle:number):void {
    const c=Math.cos(angle),s=Math.sin(angle);
    for(const [id,p] of this.contactOffsets)this.contactOffsets.set(id,{x:p.x*c-p.y*s,y:p.x*s+p.y*c});
    this.reservePress.rebaseFrame(angle);
  }

  sample(
    now: number,
    anchor: Point,
    slots: readonly SoldierSlot[],
    intent: EngagementIntent,
  ) {
    this.heading ??= intent.travelHeading;
    if(intent.canonicalHeading)this.heading=intent.travelHeading;
    const dt =
      this.previous === undefined
        ? 0
        : Math.min(0.1, Math.max(0, now - this.previous) / 1000);
    this.previous = now;
    const engaged = intent.active && !intent.charging && !!intent.target;
    if (!engaged && intent.reformInPlace) this.heading = intent.travelHeading;
    else if (!engaged) {
      const turn =
        dt * formationMovementProfile(!!intent.mounted).squadTurnRate;
      this.heading += Math.max(
        -turn,
        Math.min(turn, delta(this.heading, intent.travelHeading)),
      );
    }
    const heading = this.heading;
    const cos = Math.cos(heading),
      sin = Math.sin(heading);
    const local = (point: Point): Point => {
      const x = point.x - anchor.x,
        y = point.y - anchor.y;
      return {
        x: (x * cos + y * sin) / intent.footprint,
        y: (-x * sin + y * cos) / intent.footprint,
      };
    };
    const targets = engaged
      ? (!intent.ranged
          ? [intent.target!, ...(intent.threats ?? [])]
          : [intent.target!]
        ).map(local)
      : [];
    const primary = targets[0];
    if (primary) {
      const bearing = Math.atan2(primary.y, primary.x);
      const requested = Math.round(bearing / (Math.PI / 4));
      if (this.sector === undefined) this.sector = requested;
      // Ignore boundary noise. A genuine new fighting edge must persist 300ms.
      if (
        Math.abs(delta((this.sector * Math.PI) / 4, bearing)) >
        Math.PI / 8 + Math.PI / 15
      ) {
        if (this.candidate?.sector !== requested)
          this.candidate = { sector: requested, since: now };
        if (now - this.candidate.since >= 300) {
          this.sector = requested;
          this.candidate = undefined;
        }
      } else this.candidate = undefined;
    } else {
      this.sector = undefined;
      this.candidate = undefined;
    }
    const edges = targets.map((target, index) =>
      intent.canonicalHeading ? Math.atan2(target.y,target.x)/(Math.PI/4) : index === 0
        ? this.sector!
        : Math.round(Math.atan2(target.y, target.x) / (Math.PI / 4)),
    );
    const bounds = {
      left: Math.min(...slots.map((s) => s.x)),
      right: Math.max(...slots.map((s) => s.x)),
      rear: Math.min(...slots.map((s) => s.y)),
      forward: Math.max(...slots.map((s) => s.y)),
    };
    const onEdge = (slot: SoldierSlot, sector: number) => {
      const x = Math.cos((sector * Math.PI) / 4),
        y = Math.sin((sector * Math.PI) / 4);
      const maxX = x > 0 ? bounds.right : -bounds.left;
      const maxY = y > 0 ? bounds.forward : -bounds.rear;
      const band = slot.scale * 0.22;
      // Diagonal threats activate both adjoining edges, not only the corner man.
      return (
        (Math.abs(x) > 0.38 && maxX - slot.x * Math.sign(x) < band) ||
        (Math.abs(y) > 0.38 && maxY - slot.y * Math.sign(y) < band)
      );
    };
    const front = new Set(
      slots.filter((s) => edges.some((e) => onEdge(s, e))).map((s) => s.id),
    );
    const reserveSteps=this.reservePress.sample(dt,slots,edges,front,this.contactOffsets,{
      enabled:engaged&&!intent.ranged&&!intent.mounted,square:intent.square,layout:intent.layout,
      limit:intent.contactAdvance===undefined?undefined:intent.contactAdvance/intent.footprint,
      crowd:intent.crowdPress,
    });
    const ids = new Set(slots.map((s) => s.id));
    for (const id of this.attention.keys())
      if (!ids.has(id)) this.attention.delete(id);
    for(const id of this.contactOffsets.keys())if(!ids.has(id))this.contactOffsets.delete(id);
    const opponents = (intent.opponents ?? []).map((group) => ({
      center: local(group.center),
      group,
    }));
    const presented = slots.map((slot) => {
      const shift = reserveSteps.get(slot.id)??zero;
      let x = slot.x + shift.x,
        y = slot.y + shift.y;
      let contactGoal=zero;
      const priorContact=this.contactOffsets.get(slot.id)??zero;
      let angle =
        intent.reformInPlace && intent.travelling && !engaged
          ? 0
          : (reserveSteps.get(slot.id)?.angle??slot.angle??0);
      let inMeleeContact=!intent.canonicalHeading || intent.meleeReach===undefined;
      let target:Point|undefined;
      if (engaged && (!intent.square || intent.ranged || front.has(slot.id))) {
        // Square defenders retain their own edge's attention, including rear attacks.
        target =
          !intent.ranged
            ? targets
                .filter((_, i) => onEdge(slot, edges[i]))
                .sort(
                  (a, b) =>
                    Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y),
                )[0]
            : primary;
        if (target && !intent.ranged) {
          const contact = opponents.find(
            (group) =>
              Math.hypot(
                group.center.x - target!.x,
                group.center.y - target!.y,
              ) < 0.001,
          );
          if (contact?.group.soldiers.length) {
            // Prefer opponents ahead of this slot on its fighting edge. This
            // spreads attention across the actual frontage instead of converging
            // every weapon on the squad center. Overlapping lines may have no
            // opponent ahead, in which case use the nearest visible opponent.
            let index=opponentIndexes.get(contact.group);
            if(!index)opponentIndexes.set(contact.group,index=new OpponentAttention(contact.group.soldiers));
            const origin={x:anchor.x+(x*cos-y*sin)*intent.footprint,y:anchor.y+(x*sin+y*cos)*intent.footprint};
            const direction={x:target.x*cos-target.y*sin,y:target.x*sin+target.y*cos};
            const ahead=index.nearest(origin,direction),nearest=ahead??index.nearest(origin)!;
            let previous=index.point(this.attention.get(slot.id)??'');
            if(previous && ahead && (previous.x-origin.x)*direction.x+(previous.y-origin.y)*direction.y<=0)previous=undefined;
            const distance=(point:Point)=>(point.x-origin.x)**2+(point.y-origin.y)**2;
            // Keep a living opponent through small position noise. Replace it
            // when it leaves this edge, dies, or another is materially nearer.
            const chosen =
              previous && distance(nearest) >= distance(previous) * (0.85**2)
                ? previous
                : nearest;
            this.attention.set(slot.id, chosen.id);
            target = local(chosen);
          } else {
            this.attention.delete(slot.id);
            if(contact?.group.boundary){
              const origin={x:anchor.x+(x*cos-y*sin)*intent.footprint,y:anchor.y+(x*sin+y*cos)*intent.footprint};
              const point=nearestContactPoint(origin,contact.group.boundary);
              if(point)target=local(point);
            }
          }
        } else this.attention.delete(slot.id);
        if(target && !intent.ranged && front.has(slot.id) && intent.contactAdvance!==undefined){
          const dx=target.x-x,dy=target.y-y,distance=Math.hypot(dx,dy);
          // Close only a bounded fraction of a legal contact gap. This is a
          // cosmetic front-rank step, never navigation or damage authority.
          const reach=(intent.meleeReach??0)/intent.footprint+slot.scale;
          const crowd=intent.crowdPress&&!intent.mounted&&!intent.ranged;
          const advance=Math.min(intent.contactAdvance/intent.footprint,Math.max(0,distance-reach*(crowd ? .65 : .85)));
          if(distance>0)contactGoal={x:dx/distance*advance,y:dy/distance*advance};
        }
      }
      // Lost eligibility and new attention both change the goal, never the
      // current displacement. Bound the entire correction, including release.
      const blend=1-Math.exp(-dt*8),dx=(contactGoal.x-priorContact.x)*blend,dy=(contactGoal.y-priorContact.y)*blend;
      const distance=Math.hypot(dx,dy),limit=formationMovementProfile(!!intent.mounted).stepSpeed*dt/intent.footprint;
      const factor=distance>0?Math.min(1,limit/distance):0;
      const offset={x:priorContact.x+dx*factor,y:priorContact.y+dy*factor};
      this.contactOffsets.set(slot.id,offset);x+=offset.x;y+=offset.y;
      // A supporting reserve can become the front after a casualty. Its
      // fading support step and growing contact step share one displacement
      // limit; promotion cannot temporarily double the allowed excursion.
      if(intent.contactAdvance!==undefined){
        const dx=x-slot.x,dy=y-slot.y,length=Math.hypot(dx,dy),limit=intent.contactAdvance/intent.footprint;
        if(length>limit){x=slot.x+dx/length*limit;y=slot.y+dy/length*limit;}
      }
      if(target && !intent.ranged && intent.canonicalHeading && intent.meleeReach!==undefined)
        inMeleeContact=Math.hypot(target.x-x,target.y-y)<=intent.meleeReach/intent.footprint+slot.scale;
      if (target)
        angle = Math.atan2(target.y - y, target.x - x) - Math.PI / 2;
      return {
        ...slot,
        x,
        y,
        angle,
        step: !!reserveSteps.get(slot.id)?.moving || Math.hypot(contactGoal.x-priorContact.x,contactGoal.y-priorContact.y)>.001,
        front: engaged ? intent.ranged || front.has(slot.id) && inMeleeContact : slot.front,
      };
    });
    return {
      heading,
      slots: presented,
      engaged,
      front,
      // Square replacement follows each outward-facing slot rather than one shared bearing.
      casualtyAngle:
        engaged && !intent.square
          ? (this.sector! * Math.PI) / 4 - Math.PI / 2
          : undefined,
    };
  }
}
