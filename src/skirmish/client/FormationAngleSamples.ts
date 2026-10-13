import type { Squad } from "../Protocol";
import { formationEnvelope } from "../domain/FormationGeometry";
const delta = (a: number, b: number) =>
  Math.atan2(Math.sin(b - a), Math.cos(b - a));
/** Disposable angle samples use the same publication segment as root interpolation. */
export class FormationAngleSamples {
  private tick?: number;
  private rows = new Map<number, { from: number; to: number }>();
  clear() {
    this.rows.clear();
    this.tick = undefined;
  }
  angle(id: number, blend: number) {
    const row = this.rows.get(id);
    return row ? row.from + delta(row.from, row.to) * blend : undefined;
  }
  update(
    squads: readonly Pick<
      Squad,
      | "id"
      | "kind"
      | "definitionId"
      | "troops"
      | "manpower"
      | "formation"
      | "charge"
    >[],
    tick: number,
    previousBlend: number,
  ) {
    const live = new Set<number>();
    for (const s of squads) {
      if (!s.formation) continue;
      live.add(s.id);
      const to = formationEnvelope(s, tick).angle,
        old = this.rows.get(s.id);
      this.rows.set(s.id, {
        // A reorientation has already expressed the preserved occupied slots
        // in the destination basis. Blending that basis rotates them a second
        // time; the domain slot morph owns the visible turn instead.
        from: old && !s.formation.transition?.reorientation
          ? tick !== this.tick
            ? this.angle(s.id, previousBlend)!
            : old.from
          : to,
        to,
      });
    }
    for (const id of this.rows.keys()) if (!live.has(id)) this.rows.delete(id);
    this.tick = tick;
  }
}
