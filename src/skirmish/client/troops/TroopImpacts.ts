import { UNIT } from "../../content/Units";
import { FIXED, type ArcherVolley } from "../../Protocol";
import { weaponVisual } from "../CombatEffectsViewModel";
import { drawPreviewProjectile } from "./ProjectilePresentation";

type Position = { x: number; y: number; angle: number };
interface Contact {
  key: string;
  missed?: boolean;
  squadId: number;
  soldierId: number;
  kind: string;
  angle: number;
  time: number;
  x: number;
  y: number;
}
/** Bounded client cosmetics driven by resolved aggregate contacts. A receiving
 * member is an attachment anchor, never an independently damaged game entity. */
export class TroopImpacts {
  private readonly seen = new Map<number, number>();
  private readonly hits: Contact[] = [];
  private readonly byMember = new Map<string, Contact[]>();
  private readonly stains: Contact[] = [];
  private readonly smoke: {
    x: number;
    y: number;
    time: number;
    seed: number;
  }[] = [];
  clear() {
    this.seen.clear();
    this.byMember.clear();
    this.hits.length = this.stains.length = this.smoke.length = 0;
  }
  update(
    facts: readonly ArcherVolley[],
    now: number,
    lookup: (id: number) => readonly (Position & { id: number })[],
  ) {
    for (const [id, time] of this.seen)
      if (now - time > 5000) this.seen.delete(id);
    for (const fact of facts) {
      if (fact.sourceKind === "aircraft" || this.seen.has(fact.id)) continue;
      this.seen.set(fact.id, now);
      if (
        !fact.melee &&
        !fact.impact &&
        UNIT.get(fact.definitionId ?? "")?.age === "Napoleonic" &&
        weaponVisual(fact.definitionId) === "bullet"
      ) {
        for (const member of lookup(fact.squadId))
          this.smoke.push({
            x: member.x,
            y: member.y,
            time: now,
            seed: fact.id + member.id,
          });
      }
      if (fact.impact && !fact.damage && fact.targetId === undefined) {
        const kind=weaponVisual(fact.definitionId);
        this.stains.push({key:String(fact.id),squadId:fact.squadId,soldierId:-1,kind:kind==="arrow"?"bow":kind,angle:Math.atan2(fact.toY-fact.fromY,fact.toX-fact.fromX),time:now,x:fact.toX/FIXED,y:fact.toY/FIXED,missed:true});
      }
      if (!fact.damage || fact.targetId === undefined) continue;
      const members = lookup(fact.targetId);
      if (!members.length) continue;
      const source = { x: fact.fromX / FIXED, y: fact.fromY / FIXED };
      const sorted = [...members].sort(
        (a, b) =>
          Math.hypot(a.x - source.x, a.y - source.y) -
            Math.hypot(b.x - source.x, b.y - source.y) || a.id - b.id,
      );
      const kind = fact.melee ? "melee" : weaponVisual(fact.definitionId);
      const member =
        sorted[
          (fact.id >>> 0) %
            Math.min(sorted.length, Math.max(3, Math.ceil(sorted.length / 2)))
        ];
      const contact = {
        key: String(fact.id),
        squadId: fact.targetId,
        soldierId: member.id,
        kind: kind === "arrow" ? "bow" : kind,
        angle:
          Math.atan2(member.y - source.y, member.x - source.x) - member.angle,
        time: now,
        x: member.x,
        y: member.y,
      };
      this.hits.push(contact);
      this.stains.push({ ...contact, angle: contact.angle + member.angle });
    }
    while (
      this.hits.length &&
      (now - this.hits[0].time > 8000 || this.hits.length > 512)
    )
      this.hits.shift();
    this.byMember.clear();
    for(const hit of this.hits) {
      const key=`${hit.squadId}:${hit.soldierId}`;
      const contacts=this.byMember.get(key) ?? [];
      contacts.push(hit);if(contacts.length>4)contacts.shift();
      this.byMember.set(key,contacts);
    }
    while (
      this.stains.length &&
      (now - this.stains[0].time > 45000 || this.stains.length > 1024)
    )
      this.stains.shift();
    while (
      this.smoke.length &&
      (now - this.smoke[0].time > 2400 || this.smoke.length > 384)
    )
      this.smoke.shift();
  }
  detach(squadId: number, soldierId: number, now: number) {
    const shafts = this.hits
      .filter(
        (h) =>
          h.squadId === squadId &&
          h.soldierId === soldierId &&
          now - h.time < 8000 &&
          ["bow", "bolt", "javelin"].includes(h.kind),
      )
      .slice(-4)
      .map((h) => ({ kind: h.kind, angle: h.angle }));
    for (let i = this.hits.length - 1; i >= 0; i--)
      if (
        this.hits[i].squadId === squadId &&
        this.hits[i].soldierId === soldierId
      )
        this.hits.splice(i, 1);
    this.byMember.delete(`${squadId}:${soldierId}`);
    return shafts;
  }
  ground(
    ctx: CanvasRenderingContext2D,
    now: number,
    scale: number,
    project: (x: number, y: number) => Position | { x: number; y: number },
  ) {
    for (const stain of this.stains) {
      const p = project(stain.x, stain.y),
        age = now - stain.time;
      if (
        p.x < -30 ||
        p.y < -30 ||
        p.x > ctx.canvas.clientWidth + 30 ||
        p.y > ctx.canvas.clientHeight + 30
      )
        continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(scale / 64, scale / 64);
      ctx.globalAlpha = Math.max(0, 1 - age / 45000) * 0.7;
      ctx.fillStyle = "#791c20";
      for (let n = 0; !stain.missed && n < 5; n++) {
        const a = n * 2.4 + Number(stain.key),
          r = 3 + n * 0.7;
        ctx.beginPath();
        ctx.ellipse(
          Math.cos(a) * r,
          Math.sin(a) * r,
          2 + (n % 3),
          1.5 + (n % 2),
          a,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      if (stain.missed && age >= 8000) {ctx.restore();continue;}
      if (age < 8000 && ["bow", "bolt", "javelin"].includes(stain.kind)) {
        ctx.globalAlpha *= 0.65;
        drawPreviewProjectile(ctx, stain.kind, 10, 3, stain.angle);
      }
      if (stain.kind === "bullet") {
        ctx.fillStyle = "#302b25";
        ctx.beginPath();
        ctx.ellipse(7, 4, 3, 1.8, stain.angle, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
  member(
    ctx: CanvasRenderingContext2D,
    squadId: number,
    soldierId: number,
    p: Position,
    now: number,
    scale: number,
    underlay: boolean,
  ) {
    for (const hit of this.byMember.get(`${squadId}:${soldierId}`) ?? []) {
      const age = now - hit.time;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.scale(scale / 64, scale / 64);
      if (underlay && ["bow", "bolt", "javelin"].includes(hit.kind))
        drawPreviewProjectile(ctx, hit.kind, 2, 0, hit.angle, true);
      if (!underlay) {
        ctx.fillStyle = "#8c2029";
        ctx.globalAlpha = 0.7 * (1 - age / 8000);
        ctx.beginPath();
        ctx.ellipse(-2, 0, 3, 2, hit.angle, 0, Math.PI * 2);
        ctx.fill();
        if (age < 500) {
          ctx.globalAlpha = 1 - age / 500;
          const distance = (age / 500) * 14;
          ctx.fillStyle = "#b72b32";
          for (let n = 0; n < 5; n++) {
            ctx.beginPath();
            ctx.arc(
              Math.cos(hit.angle + n * 0.13) * distance,
              Math.sin(hit.angle + n * 0.13) * distance,
              2,
              0,
              Math.PI * 2,
            );
            ctx.fill();
          }
        }
      }
      ctx.restore();
    }
  }
  drawSmoke(
    ctx: CanvasRenderingContext2D,
    now: number,
    scale: number,
    project: (x: number, y: number) => { x: number; y: number },
  ) {
    for (const puff of this.smoke) {
      const age = now - puff.time,
        t = age / 2400,
        p = project(puff.x + t * 0.22, puff.y - t * 0.12);
      if (
        t >= 1 ||
        p.x < -40 ||
        p.y < -40 ||
        p.x > ctx.canvas.clientWidth + 40 ||
        p.y > ctx.canvas.clientHeight + 40
      )
        continue;
      ctx.save();
      ctx.globalAlpha = 0.2 * (1 - t);
      ctx.fillStyle = "#c3c2ad";
      for (let n = 0; n < 3; n++) {
        ctx.beginPath();
        ctx.arc(
          p.x + Math.cos(puff.seed + n * 2) * scale * 0.09,
          p.y + Math.sin(puff.seed + n * 2) * scale * 0.09,
          scale * (0.08 + t * 0.18),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.restore();
    }
  }
}
