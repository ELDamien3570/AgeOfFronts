import {secondsToTicks} from '../Protocol';
import { FIXED, type Command, type Squad } from "../Protocol";
import { BUDGETS, TRENCH } from "../content/TacticalRules";
import type { Expansion } from "./Expansion";
import {
  createFormation,
  facingOf,
  formationDoctrine,
  formationSlots,
  radians,
} from "./FormationGeometry";
import { frontageLayout } from "./FormationProfiles";

export interface TrenchSegment {
  key: string;
  ownerId: number;
  tiles: number[];
  capacity: number;
  facing: number;
  neighbours: string[];
  anchors: { x: number; y: number }[];
}
export interface Occupant {
  squadId: number;
  ownerId: number;
  segments: string[];
  reservedCapacity: number;
  facing: number;
  phase: "entering" | "occupying" | "leaving";
  sinceTick: number;
  entryTile: number;
  /** Exact purchased slots survive deaths, saves and capacity changes. */
  slots: { segment: string; index: number }[];
}
export type OccupancyView = Pick<
  Occupant,
  "segments" | "reservedCapacity" | "phase" | "entryTile"
> & { facing: number };
export function validateOccupancy(value: OccupancyView | undefined): void {
  if (value === undefined) return;
  if (
    !value ||
    !["entering", "occupying", "leaving"].includes(value.phase) ||
    !Number.isSafeInteger(value.reservedCapacity) ||
    value.reservedCapacity < 1 ||
    value.reservedCapacity > 144 ||
    !Number.isSafeInteger(value.entryTile) ||
    value.entryTile < 0 ||
    !Number.isSafeInteger(value.facing) ||
    value.facing < 0 ||
    value.facing >= 65536 ||
    !Array.isArray(value.segments) ||
    !value.segments.length ||
    value.segments.length > TRENCH.maxSegmentsPerSquad ||
    value.segments.some(
      (k) => typeof k !== "string" || !/^b:\d+$|^r:\d+:\d+$/.test(k),
    )
  )
    throw new Error("Invalid trench occupancy");
}
/** One authority for admission, cover, purchased capacity and actor anchors. */
export class TrenchOccupancy {
  readonly segments = new Map<string, TrenchSegment>();
  readonly occupants = new Map<number, Occupant>();
  private byTile = new Map<number, string[]>();
  private signature = "";
  private revision = "";
  private queue: {
    playerId: number;
    squadId: number;
    tile: number;
    frontageTiles?: number[];
  }[] = [];
  private budgetTick = -1;
  private used = 0;
  private internal = 0;
  constructor(private readonly e: Expansion) {}
  checkpoint() {
    return structuredClone({
      occupants: [...this.occupants.values()],
      queue: this.queue,
      budgetTick: this.budgetTick,
      used: this.used,
    });
  }
  restore(saved: ReturnType<TrenchOccupancy["checkpoint"]>): void {
    this.occupants.clear();
    this.signature = "";
    this.revision = "";
    this.rebuild();
    const occupied = new Set<string>();
    for (const o of structuredClone(saved.occupants)) {
      const s = this.e.world.squad(o.squadId);
      validateOccupancy(o);
      if (
        !s ||
        s.playerId !== o.ownerId ||
        this.occupants.has(o.squadId) ||
        !Number.isSafeInteger(o.sinceTick) ||
        o.sinceTick < 0 ||
        o.slots.length !== o.reservedCapacity
      )
        throw new Error("Invalid trench reservation");
      for (const [i, key] of o.segments.entries()) {
        const segment = this.segments.get(key);
        if (
          !segment ||
          segment.ownerId !== o.ownerId ||
          (i > 0 &&
            !o.segments
              .slice(0, i)
              .some((k) => this.segments.get(k)!.neighbours.includes(key)))
        )
          throw new Error("Invalid trench reservation topology");
      }
      for (const slot of o.slots) {
        const segment = this.segments.get(slot.segment),
          key = `${slot.segment}/${slot.index}`;
        if (
          !o.segments.includes(slot.segment) ||
          !segment ||
          !Number.isSafeInteger(slot.index) ||
          slot.index < 0 ||
          slot.index >= segment.capacity ||
          occupied.has(key)
        )
          throw new Error("Overlapping trench reservation");
        occupied.add(key);
      }
      this.occupants.set(o.squadId, o);
    }
    if (
      !Array.isArray(saved.queue) ||
      saved.queue.some(
        (q) =>
          ![q.playerId, q.squadId, q.tile].every(Number.isSafeInteger) ||
          q.playerId <= 0 ||
          q.squadId <= 0 ||
          q.tile < 0 ||
          q.tile >= this.e.world.map.width() * this.e.world.map.height() ||
          (q.frontageTiles !== undefined &&
            (!Array.isArray(q.frontageTiles) ||
              !q.frontageTiles.length ||
              q.frontageTiles.length > 64 ||
              new Set(q.frontageTiles).size !== q.frontageTiles.length ||
              q.frontageTiles.some(
                (t) =>
                  !Number.isSafeInteger(t) ||
                  t < 0 ||
                  t >= this.e.world.map.width() * this.e.world.map.height(),
              ))),
      ) ||
      !Number.isSafeInteger(saved.used) ||
      saved.used < 0 ||
      saved.used > BUDGETS.trenchAdmission ||
      !Number.isSafeInteger(saved.budgetTick)
    )
      throw new Error("Invalid trench admission queue");
    this.queue = structuredClone(saved.queue);
    this.used = saved.used;
    this.budgetTick = saved.budgetTick;
    for (const o of this.occupants.values()) this.publish(o);
  }
  rebuild(): void {
    const { world: w, fortifications: f } = this.e;
    const revision = `${f.barrierChanges.revision}:${w.trenchBuildingRevision()}`;
    if (revision === this.revision) return;
    this.revision = revision;
    const buildings = w.buildings.filter(
      (b) => b.type === "trench" && !b.remainingTicks && (b.health ?? 1) > 0,
    );
    const runs = f.barriers.filter(
      (b) => b.kind === "trench" && !b.remainingTicks && b.health > 0,
    );
    // Construction completion and destruction do not always change the wall
    // route revision. Include their journal-visible identities in this key.
    const signature =
      buildings.map((b) => `${b.id}:${b.playerId}:${b.tile}`).join("|") +
      ";" +
      runs.map((r) => `${r.id}:${r.playerId}:${r.tiles.join(",")}`).join("|");
    if (signature === this.signature) return;
    this.signature = signature;
    this.segments.clear();
    this.byTile.clear();
    const allTiles = new Set([
      ...buildings.map((b) => b.tile),
      ...runs.flatMap((r) => [...r.tiles]),
    ]);
    const add = (key: string, ownerId: number, tiles: number[]) => {
      let nx = 0,
        ny = 0;
      for (const tile of tiles)
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const x = w.map.x(tile) + dx,
            y = w.map.y(tile) + dy;
          if (
            w.map.isValidCoord(x, y) &&
            w.owners[w.map.ref(x, y)] === ownerId
          ) {
            nx -= dx;
            ny -= dy;
          }
        }
      const first = tiles[0],
        last = tiles[tiles.length - 1];
      const adjacent = [
        first - 1,
        first + 1,
        first - w.map.width(),
        first + w.map.width(),
      ].find(
        (t) =>
          allTiles.has(t) &&
          Math.abs(w.map.x(t) - w.map.x(first)) +
            Math.abs(w.map.y(t) - w.map.y(first)) ===
            1,
      );
      const dx =
          w.map.x(last) - w.map.x(first) ||
          (adjacent === undefined ? 1 : w.map.x(adjacent) - w.map.x(first)),
        dy =
          w.map.y(last) - w.map.y(first) ||
          (adjacent === undefined ? 0 : w.map.y(adjacent) - w.map.y(first));
      const vertical = Math.abs(dy) > Math.abs(dx),
        tx = vertical ? 0 : 1,
        ty = vertical ? 1 : 0;
      const forward = nx * ty - ny * tx;
      const facing = facingOf(Math.atan2(ty, tx) + (forward < 0 ? Math.PI : 0));
      const anchors = tiles.flatMap((tile) =>
        Array.from({ length: TRENCH.slotsPerTile }, (_, i) => {
          const d = ((i + 0.5) / TRENCH.slotsPerTile - 0.5) * FIXED;
          return {
            x: Math.round((w.map.x(tile) + 0.5) * FIXED + tx * d),
            y: Math.round((w.map.y(tile) + 0.5) * FIXED + ty * d),
          };
        }),
      );
      const segment = {
        key,
        ownerId,
        tiles,
        capacity: anchors.length,
        facing,
        neighbours: [],
        anchors,
      };
      this.segments.set(key, segment);
      for (const tile of tiles) {
        const list = this.byTile.get(tile) ?? [];
        list.push(key);
        this.byTile.set(tile, list);
      }
    };
    for (const b of buildings.sort((a, b) => a.id - b.id))
      add(`b:${b.id}`, b.playerId, [b.tile]);
    for (const r of runs.sort((a, b) => a.id - b.id))
      for (let i = 0; i < r.tiles.length; i += TRENCH.segmentTiles)
        add(
          `r:${r.id}:${i / TRENCH.segmentTiles}`,
          r.playerId,
          r.tiles.slice(i, i + TRENCH.segmentTiles),
        );
    for (const s of this.segments.values()) {
      const neighbours = new Set<string>();
      for (const tile of s.tiles)
        for (const [dx, dy] of [
          [0, 0],
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const x = w.map.x(tile) + dx,
            y = w.map.y(tile) + dy;
          if (!w.map.isValidCoord(x, y)) continue;
          for (const key of this.byTile.get(w.map.ref(x, y)) ?? []) {
            const other = this.segments.get(key)!;
            if (key !== s.key && other.ownerId === s.ownerId)
              neighbours.add(key);
          }
        }
      s.neighbours = [...neighbours].sort();
    }
  }
  at(tile: number, ownerId: number): TrenchSegment | undefined {
    this.rebuild();
    return (this.byTile.get(tile) ?? [])
      .map((k) => this.segments.get(k)!)
      .find((s) => s.ownerId === ownerId);
  }
  eligible(s: Squad): boolean {
    const d = formationDoctrine(s.definitionId);
    return (
      s.troops > 0 &&
      s.manpower?.model === "soldiers" &&
      !d.hull &&
      !d.mounted &&
      s.embarkedOn === null &&
      !s.afloat &&
      !s.refit &&
      !s.manpower.enlargement &&
      !s.charge
    );
  }
  private available(key: string, except?: number): number[] {
    const segment = this.segments.get(key)!;
    const used = new Set<number>();
    for (const o of this.occupants.values())
      if (o.squadId !== except)
        for (const slot of o.slots)
          if (slot.segment === key) used.add(slot.index);
    return Array.from({ length: segment.capacity }, (_, i) => i).filter(
      (i) => !used.has(i),
    );
  }
  private allocate(
    tile: number,
    owner: number,
    capacity: number,
    except?: number,
    frontageTiles?: readonly number[],
  ): { segments: string[]; slots: Occupant["slots"] } | undefined {
    const start = this.at(tile, owner);
    if (!start) return;
    const segments = [start.key],
      slots: Occupant["slots"] = [];
    let left = true;
    while (true) {
      const key = segments[segments.length - 1];
      for (const index of this.available(key, except)) {
        const anchorTile =
          this.segments.get(key)!.tiles[
            Math.floor(index / TRENCH.slotsPerTile)
          ];
        if (!frontageTiles || frontageTiles.includes(anchorTile))
          slots.push({ segment: key, index });
      }
      if (segments.length >= TRENCH.maxSegmentsPerSquad) break;
      const candidates = [
        ...new Set(segments.flatMap((k) => this.segments.get(k)!.neighbours)),
      ]
        .filter(
          (k) =>
            !segments.includes(k) &&
            (!frontageTiles ||
              this.segments
                .get(k)!
                .tiles.some((t) => frontageTiles.includes(t))),
        )
        .sort((a, b) => {
          const aa = this.segments.get(a)!.anchors[0],
            bb = this.segments.get(b)!.anchors[0],
            angle = radians(start.facing);
          return (
            (this.segments.get(b)!.tiles.length -
              this.segments.get(a)!.tiles.length) ||
              (aa.x - bb.x) * Math.cos(angle) +
              (aa.y - bb.y) * Math.sin(angle) || a.localeCompare(b)
          );
        });
      if (!candidates.length) break;
      const largest = this.segments.get(candidates[0])!.tiles.length;
      const options = candidates.filter(
        (k) => this.segments.get(k)!.tiles.length === largest,
      );
      segments.push(left ? options[0] : options[options.length - 1]);
      left = !left;
    }
    const w = this.e.world,
      angle = radians(start.facing),
      origin = {
        x: (w.map.x(tile) + 0.5) * FIXED,
        y: (w.map.y(tile) + 0.5) * FIXED,
      };
    const anchor = (slot: Occupant["slots"][number]) =>
      this.segments.get(slot.segment)!.anchors[slot.index];
    slots.sort((a, b) => {
      const aa = anchor(a),
        bb = anchor(b);
      if (frontageTiles) {
        const ta = this.segments.get(a.segment)!.tiles[
            Math.floor(a.index / TRENCH.slotsPerTile)
          ],
          tb = this.segments.get(b.segment)!.tiles[
            Math.floor(b.index / TRENCH.slotsPerTile)
          ];
        return (
          frontageTiles.indexOf(ta) - frontageTiles.indexOf(tb) ||
          (a.index % TRENCH.slotsPerTile) - (b.index % TRENCH.slotsPerTile)
        );
      }
      return (
        (aa.x - bb.x) * Math.cos(angle) + (aa.y - bb.y) * Math.sin(angle) ||
        aa.x - bb.x ||
        aa.y - bb.y
      );
    });
    let best: Occupant["slots"] | undefined,
      bestScore = Infinity;
    for (let i = 0; i + capacity <= slots.length; i++) {
      const window = slots.slice(i, i + capacity);
      if (
        window.some((slot, j) => {
          if (!j) return false;
          const prev = window[j - 1],
            ta = this.segments.get(slot.segment)!.tiles[
              Math.floor(slot.index / TRENCH.slotsPerTile)
            ],
            tb = this.segments.get(prev.segment)!.tiles[
              Math.floor(prev.index / TRENCH.slotsPerTile)
            ];
          return ta === tb
            ? Math.abs(slot.index - prev.index) !== 1
            : Math.abs(w.map.x(ta) - w.map.x(tb)) +
                Math.abs(w.map.y(ta) - w.map.y(tb)) !==
                1 ||
                Math.hypot(
                  anchor(slot).x - anchor(prev).x,
                  anchor(slot).y - anchor(prev).y,
                ) >
                  FIXED * 0.8;
        })
      )
        continue;
      const center = {
        x: window.reduce((n, slot) => n + anchor(slot).x, 0) / capacity,
        y: window.reduce((n, slot) => n + anchor(slot).y, 0) / capacity,
      };
      const score = Math.hypot(center.x - origin.x, center.y - origin.y);
      if (score < bestScore) {
        best = window;
        bestScore = score;
      }
    }
    if (!best) return;
    return {
      segments: segments.filter((key) => best!.some((s) => s.segment === key)),
      slots: best,
    };
  }
  canFit(s: Squad, tile: number): boolean {
    return (
      !!s.manpower &&
      !!this.allocate(tile, s.playerId, s.manpower.capacity, s.id)
    );
  }
  command(command: Extract<Command, { type: "occupy" }>): string | null {
    if (command.append)
      return "Queued trench occupation is not supported; issue an immediate order";
    const w = this.e.world;
    const frontage = command.frontageTiles;
    if (
      frontage &&
      (!frontage.includes(command.tile) ||
        frontage.some((t) => !this.at(t, command.playerId)) ||
        frontage.some(
          (t, i) =>
            i > 0 &&
            Math.abs(w.map.x(t) - w.map.x(frontage[i - 1])) +
              Math.abs(w.map.y(t) - w.map.y(frontage[i - 1])) !==
              1,
        ))
    )
      return "Draw along one contiguous owned trench";
    if (!this.at(command.tile, command.playerId))
      return "Choose a completed owned trench";
    const squads = [...new Set(command.squadIds)]
      .map((id) => w.squad(id))
      .filter(
        (s): s is Squad =>
          !!s && s.playerId === command.playerId && this.eligible(s),
      )
      .sort(
        (a, b) =>
          w.map.euclideanDistSquared(w.tileOf(a), command.tile) -
            w.map.euclideanDistSquared(w.tileOf(b), command.tile) ||
          a.id - b.id,
      );
    if (!squads.length)
      return "Select eligible foot soldiers outside transport, charge or paid operations";
    if (frontage) {
      const dx = w.map.x(frontage[frontage.length - 1]) - w.map.x(frontage[0]),
        dy = w.map.y(frontage[frontage.length - 1]) - w.map.y(frontage[0]);
      squads.sort((a, b) => (a.x - b.x) * dx + (a.y - b.y) * dy || a.id - b.id);
    }
    // A batch that admits nobody is a rejection and must leave no trace:
    // admit() writes only on success, so restoring these is exact (R2-M10).
    const saved = { queue: this.queue, used: this.used, budgetTick: this.budgetTick };
    this.resetBudget();
    let accepted = 0,
      error = "Not enough trench space";
    for (const [index, s] of squads.entries()) {
      const target =
        frontage?.[
          Math.min(
            frontage.length - 1,
            Math.floor(((index + 0.5) * frontage.length) / squads.length),
          )
        ] ?? command.tile;
      this.queue = this.queue.filter((q) => q.squadId !== s.id);
      if (this.used >= BUDGETS.trenchAdmission) {
        this.queue.push({
          playerId: command.playerId,
          squadId: s.id,
          tile: target,
          frontageTiles: frontage,
        });
        accepted++;
        continue;
      }
      this.used++;
      const result = this.admit(s, target, frontage);
      if (result === null) accepted++;
      else error = result;
    }
    if (accepted) return null;
    this.queue = saved.queue;
    this.used = saved.used;
    this.budgetTick = saved.budgetTick;
    return error;
  }
  private resetBudget() {
    if (this.budgetTick !== this.e.world.tick) {
      this.budgetTick = this.e.world.tick;
      this.used = 0;
    }
  }
  private admit(
    s: Squad,
    tile: number,
    frontageTiles?: number[],
  ): string | null {
    const allocation = this.allocate(
      tile,
      s.playerId,
      s.manpower!.capacity,
      s.id,
      frontageTiles,
    );
    if (!allocation) return "Not enough trench space";
    const w = this.e.world,
      entryTile = [
        ...new Set(
          allocation.slots.map(
            (slot) =>
              this.segments.get(slot.segment)!.tiles[
                Math.floor(slot.index / TRENCH.slotsPerTile)
              ],
          ),
        ),
      ].sort(
        (a, b) =>
          w.map.euclideanDistSquared(w.tileOf(s), a) -
            w.map.euclideanDistSquared(w.tileOf(s), b) || a - b,
      )[0];
    const path = w.paths.find(w.tileOf(s), entryTile, (t) =>
      this.e.fortifications.blocked(t, s.playerId),
    );
    if (path === null) return "No legal route to the trench";
    this.internal++;
    try {
      w.setArmyMove(
        s,
        {
          x: (w.map.x(entryTile) + 0.5) * FIXED,
          y: (w.map.y(entryTile) + 0.5) * FIXED,
        },
        path,
      );
    } finally {
      this.internal--;
    }
    this.clearLayout(w.squad(s.id)!);
    const o: Occupant = {
      squadId: s.id,
      ownerId: s.playerId,
      facing: this.segments.get(allocation.segments[0])!.facing,
      ...allocation,
      reservedCapacity: s.manpower!.capacity,
      phase: "entering",
      sinceTick: w.tick,
      entryTile,
    };
    this.occupants.set(s.id, o);
    this.publish(o);
    return null;
  }
  /** Operation-wide transaction: never consume resources before all deltas fit. */
  reserveChanges(changes: { id: number; capacity: number }[]): boolean {
    this.rebuild();
    const saved = structuredClone([...this.occupants]);
    for (const change of changes) {
      const o = this.occupants.get(change.id);
      if (!o) continue;
      const allocation = this.allocate(
        o.entryTile,
        o.ownerId,
        change.capacity,
        o.squadId,
      );
      if (!allocation) {
        this.occupants.clear();
        for (const [id, value] of saved) this.occupants.set(id, value);
        return false;
      }
      Object.assign(o, allocation, { reservedCapacity: change.capacity });
    }
    for (const change of changes) {
      const o = this.occupants.get(change.id);
      if (o) {
        this.publish(o);
        if (o.phase === "occupying") this.layout(o);
      }
    }
    return true;
  }
  observe(command: Command): void {
    if (this.internal) return;
    if (
      "squadIds" in command &&
      (command.type === "order" ||
        command.type === "charge" ||
        command.type === "attack-structure")
    )
      for (const id of command.squadIds) {
        const owner = this.e.world.squad(id)?.playerId;
        if (owner !== undefined && owner !== command.playerId) continue;
        this.queue = this.queue.filter((q) => q.squadId !== id);
        if (command.type !== "order" || command.order.type !== "hold")
          this.leave(id);
      }
    if (command.type === "army-order" && command.order.type !== "hold") {
      const army = this.e.armies.armies.find((a) => a.id === command.armyId && a.playerId === command.playerId);
      for (const id of army?.memberIds ?? []) this.leave(id);
    }
  }
  orderChanged(s: Squad, order: Squad["order"]): void {
    if (!this.internal && order.type !== "hold") this.leave(s.id);
  }
  leave(id: number): void {
    const o = this.occupants.get(id);
    if (!o || o.phase === "leaving") return;
    o.phase = "leaving";
    o.sinceTick = this.e.world.tick;
    const s = this.e.world.squad(id);
    if (s) this.clearLayout(s);
    this.publish(o);
  }
  private clearLayout(s: Squad): void {
    if (!s.formation?.occupationSlots) return;
    const f = s.formation,
      source = formationSlots(s, this.e.world.tick);
    this.e.world.updateSquad(s.id, {
      formation: {
        ...f,
        occupationSlots: undefined,
        frontage:f.preferredFrontage===undefined?undefined:frontageLayout(s.troops,formationDoctrine(s.definitionId),f.shape,f.preferredFrontage)?.width,
        revision: f.revision + 1,
        transition: {
          occupationReform: true,
          from: f.shape,
          fromFacing: f.facing,
          fromSlots: source,
          startTick: this.e.world.tick,
          duration: secondsToTicks(2),
        },
      },
    });
  }
  private release(id: number, hold = false): void {
    const s = this.e.world.squad(id);
    this.occupants.delete(id);
    if (s) {
      this.clearLayout(s);
      this.e.world.updateSquad(id, {
        occupancy: undefined,
        ...(hold ? { order: { type: "hold" } as const } : {}),
      });
      if (hold) this.e.world.installSquadPath(id, []);
    }
  }
  private publish(o: Occupant): void {
    this.e.world.updateSquad(o.squadId, {
      occupancy: {
        segments: [...o.segments],
        reservedCapacity: o.reservedCapacity,
        phase: o.phase,
        entryTile: o.entryTile,
        facing: o.facing,
      },
    });
  }
  private layout(o: Occupant): void {
    const w = this.e.world,
      s = w.squad(o.squadId)!;
    const anchors = o.slots.map(
      (slot) => this.segments.get(slot.segment)!.anchors[slot.index],
    );
    const center = {
      x: Math.round(anchors.reduce((n, p) => n + p.x, 0) / anchors.length),
      y: Math.round(anchors.reduce((n, p) => n + p.y, 0) / anchors.length),
    };
    const f = s.formation ?? createFormation(s.definitionId),
      facing = o.facing,
      a = radians(facing),
      c = Math.cos(a),
      sin = Math.sin(a);
    const source = formationSlots(s, w.tick).map((p) => {
      const old = radians(f.facing),
        x = p.x * Math.cos(old) - p.y * Math.sin(old),
        y = p.x * Math.sin(old) + p.y * Math.cos(old);
      return {
        x: Math.round(x * c + y * sin),
        y: Math.round(-x * sin + y * c),
        row: p.row,
      };
    });
    const slots = anchors.map((p) => ({
      x: Math.round((p.x - center.x) * c + (p.y - center.y) * sin),
      y: Math.round(-(p.x - center.x) * sin + (p.y - center.y) * c),
      row: 0,
    }));
    w.updateSquad(s.id, {
      formation: {
        ...f,
        facing,
        occupationSlots: slots,
        automatic: false,
        trail: undefined,
        mode: "deployed",
        shape:f.shape==='column'?f.deployedShape??formationDoctrine(s.definitionId).defaultShape:f.shape,
        preferredFrontage:f.preferredFrontage??f.frontage,
        revision: f.revision + 1,
        frontage: undefined,
        transition: {
          occupationReform: true,
          from: f.shape,
          fromFacing: facing,
          fromSlots: source,
          startTick: w.tick,
          duration: secondsToTicks(2),
        },
      },
    });
    // Short admitted carrier translation; actors interpolate to purchased anchors.
    const tile = w.map.ref(
      Math.floor(center.x / FIXED),
      Math.floor(center.y / FIXED),
    );
    this.internal++;
    try {
      w.setArmyMove(w.squad(s.id)!, center, tile === w.tileOf(s) ? [] : [tile]);
    } finally {
      this.internal--;
    }
  }
  step(): void {
    this.rebuild();
    this.resetBudget();
    const w = this.e.world;
    while (this.queue.length && this.used < BUDGETS.trenchAdmission) {
      const q = this.queue.shift()!,
        s = w.squad(q.squadId);
      this.used++;
      if (s && s.playerId === q.playerId && this.eligible(s))
        this.admit(s, q.tile, q.frontageTiles);
    }
    for (const o of [...this.occupants.values()]) {
      const s = w.squad(o.squadId);
      if (
        !s ||
        s.troops <= 0 ||
        s.playerId !== o.ownerId ||
        s.afloat ||
        s.embarkedOn !== null
      ) {
        this.release(o.squadId);
        continue;
      }
      if (
        o.segments.some(
          (k) =>
            !this.segments.has(k) ||
            this.segments.get(k)!.ownerId !== o.ownerId,
        )
      ) {
        this.release(s.id, true);
        continue;
      }
      if (o.phase === "leaving") {
        if (
          o.slots.every((slot) => {
            const p = this.segments.get(slot.segment)!.anchors[slot.index];
            return Math.hypot(s.x - p.x, s.y - p.y) > FIXED;
          })
        )
          this.release(s.id);
        continue;
      }
      if (
        s.formation?.transition?.occupationReform &&
        w.tick >=
          s.formation.transition.startTick + s.formation.transition.duration
      ) {
        w.updateSquad(s.id, {
          formation: { ...s.formation, transition: undefined },
        });
      }
      if (o.phase === "entering") {
        const points = o.slots.map(
          (slot) => this.segments.get(slot.segment)!.anchors[slot.index],
        );
        const center = {
          x: Math.round(points.reduce((n, p) => n + p.x, 0) / points.length),
          y: Math.round(points.reduce((n, p) => n + p.y, 0) / points.length),
        };
        if (
          !s.formation?.occupationSlots &&
          Math.hypot(s.x - center.x, s.y - center.y) <= FIXED * 3
        )
          this.layout(o);
        if (
          s.formation?.occupationSlots &&
          !s.moved &&
          Math.hypot(s.x - center.x, s.y - center.y) <= FIXED * 0.5
        ) {
          o.phase = "occupying";
          o.sinceTick = w.tick;
          this.publish(o);
        }
      }
      const purchased =
        s.manpower?.enlargement?.targetCapacity ??
        (s.refit ? recipeRefitCapacity(this.e, s) : s.manpower?.capacity);
      if (purchased !== undefined && purchased !== o.reservedCapacity)
        this.reserveChanges([{ id: s.id, capacity: purchased }]);
    }
  }
  cover(s: Squad, source?: { x: number; y: number }): number {
    const o = this.occupants.get(s.id);
    if (
      o?.phase !== "occupying" ||
      o.segments.some((k) => !this.segments.has(k))
    )
      return 0;
    const a = radians(o.facing);
    return source &&
      (source.x - s.x) * Math.sin(a) - (source.y - s.y) * Math.cos(a) < 0
      ? 0
      : TRENCH.reductionBp;
  }
}
function recipeRefitCapacity(e: Expansion, s: Squad): number | undefined {
  return s.refit
    ? e.unit({ ...s, definitionId: s.refit.targetId }).formationRecipe?.[
        s.refit.recipeVariant === "enlarged" ? "enlargedCapacity" : "capacity"
      ]
    : undefined;
}
