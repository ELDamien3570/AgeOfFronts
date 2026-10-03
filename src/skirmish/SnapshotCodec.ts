import type { TileChangeJournal } from "./TileChangeJournal";
import type {
  Building,
  BuildingType,
  Order,
  Snapshot,
  SnapshotPacket,
  SquadType,
} from "./Protocol";
import { BUILDING_RULES } from "./Rules";

type SnapshotSource = Omit<Snapshot, "buildings"> & { readonly buildings: readonly Building[] };

export const SNAPSHOT_LAYOUT = Object.freeze({ squadStride: 14, orderStride: 6, buildingStride: 5 });
const { squadStride: SQUAD_STRIDE, orderStride: ORDER_STRIDE, buildingStride: BUILDING_STRIDE } = SNAPSHOT_LAYOUT;
const SQUAD_TYPES: SquadType[] = ["infantry", "archer", "cavalry"];
const BUILDING_TYPES = Object.keys(BUILDING_RULES) as BuildingType[];
const ORDER_TYPES: Order["type"][] = [
  "hold",
  "replenish",
  "board",
  "move",
  "attack",
];

function writeOrder(output: Int32Array, at: number, order: Order) {
  output[at] = ORDER_TYPES.indexOf(order.type);
  if (order.type === "move" || order.type === "board")
    output[at + 1] = order.tile;
  if (order.type === "board") output[at + 2] = order.shipId;
  if (order.type === "attack") output[at + 2] = order.targetId;
  if (order.type === "move" && order.x !== undefined) {
    output[at + 3] = order.x;
    output[at + 4] = order.y!;
    output[at + 5] = 1;
  }
}
function readOrder(input: Int32Array, at: number): Order {
  const type = ORDER_TYPES[input[at]];
  if (type === "attack") return { type, targetId: input[at + 2] };
  if (type === "board")
    return { type, tile: input[at + 1], shipId: input[at + 2] };
  if (type === "move")
    return {
      type,
      tile: input[at + 1],
      ...(input[at + 5] ? { x: input[at + 3], y: input[at + 4] } : {}),
    };
  return { type };
}

// Worker adapter: only presentation fields leave the authoritative domain.
// Numeric buffers are transferred; ownership/construction changes are deltas.
export class SnapshotEncoder {
  private journal?: TileChangeJournal;
  private journalRevision = 0;
  readonly diagnostics = { tileReads: 0 };
  // Fresh network clients reset their arrays to zero, so neutral tiles need no wire entry.
  constructor(private readonly sparseBaseline = false) {}
  private previousRoadRevision = -1;
  private depositGeometry = "";
  private readonly depositOwners = new Map<number, number>();
  private previousTiles?: Uint32Array;
  private readonly buildings = new Map<
    number,
    { owner: number; kind: BuildingType; tile: number; ticks: number }
  >();
  private width = 0;
  private height = 0;
  /** Align existing subscribers and a newcomer to the same immutable tick boundary. */
  encodeJoinBarrier(source: SnapshotSource, journal?: TileChangeJournal): {
    shared: SnapshotPacket;
    baseline: SnapshotPacket;
  } {
    return {
      shared: this.encode(source, journal),
      baseline: new SnapshotEncoder(true).encode(source),
    };
  }
  encode(source: SnapshotSource, journal?: TileChangeJournal): SnapshotPacket {
    const reset =
      !this.previousTiles ||
      this.width !== source.width ||
      this.height !== source.height;
    if (reset) {
      this.previousTiles = new Uint32Array(source.owners.length);
      this.buildings.clear();
      this.width = source.width;
      this.height = source.height;
    }
    const tileChanges: number[] = [];
    const dirtyTiles = !reset && journal && journal === this.journal ? journal.since(this.journalRevision)?.sort((a, b) => a - b) : undefined;
    const count = dirtyTiles?.length ?? source.owners.length;
    this.diagnostics.tileReads = count;
    for (let index = 0; index < count; index++) {
      const tile = dirtyTiles ? dirtyTiles[index] : index;
      const value =
        source.owners[tile] |
        (source.claims[tile] << 8) |
        (source.progress[tile] << 16);
      if (
        (reset && !this.sparseBaseline) ||
        value !== this.previousTiles![tile]
      ) {
        tileChanges.push(tile, value);
        this.previousTiles![tile] = value;
      }
    }
    this.journal = journal;
    this.journalRevision = journal?.revision ?? 0;
    const squads = new Int32Array(source.squads.length * SQUAD_STRIDE);
    const orderCount = source.squads.reduce(
      (sum, s) => sum + 1 + s.queuedOrders.length,
      0,
    );
    const orders = new Int32Array(orderCount * ORDER_STRIDE);
    let offset = 0;
    source.squads.forEach((s, index) => {
      const at = index * SQUAD_STRIDE;
      squads.set(
        [
          s.id,
          s.playerId,
          s.x,
          s.y,
          s.troops,
          SQUAD_TYPES.indexOf(s.kind),
          s.embarkedOn ?? -1,
          s.lastCombatTick,
          Number(s.moved),
          s.firingCharge,
          Number(s.fighting),
          s.combatTargetId ?? -1,
          offset,
          s.queuedOrders.length + 1,
        ],
        at,
      );
      writeOrder(orders, offset * ORDER_STRIDE, s.order);
      offset++;
      for (const order of s.queuedOrders) {
        writeOrder(orders, offset * ORDER_STRIDE, order);
        offset++;
      }
    });
    const changed: number[] = [],
      live = new Set<number>();
    for (const b of source.buildings) {
      live.add(b.id);
      const old = this.buildings.get(b.id);
      if (
        old &&
        old.owner === b.playerId &&
        old.kind === b.type &&
        old.tile === b.tile &&
        old.ticks === b.remainingTicks
      )
        continue;
      this.buildings.set(b.id, {
        owner: b.playerId,
        kind: b.type,
        tile: b.tile,
        ticks: b.remainingTicks,
      });
      changed.push(
        b.id,
        b.playerId,
        BUILDING_TYPES.indexOf(b.type),
        b.tile,
        b.remainingTicks,
      );
    }
    const removed: number[] = [];
    for (const id of this.buildings.keys())
      if (!live.has(id)) {
        removed.push(id);
        this.buildings.delete(id);
      }
    const geometry = source.expansion?.deposits.map(d => `${d.id}:${d.tile}:${d.resource}:${d.yieldPerSecond}`).join("|") ?? "";
    const resourceReset = reset || geometry !== this.depositGeometry;
    const depositOwners: number[] = [];
    if (resourceReset) this.depositOwners.clear();
    for (const deposit of source.expansion?.deposits ?? []) {
      if (!resourceReset && this.depositOwners.get(deposit.id) !== deposit.owner) depositOwners.push(deposit.id, deposit.owner);
      this.depositOwners.set(deposit.id, deposit.owner);
    }
    this.depositGeometry = geometry;
    const expansion = source.expansion
      ? {
          ...source.expansion,
          deposits: resourceReset ? source.expansion.deposits.map(d => ({...d})) : undefined,
          depositOwners: depositOwners.length ? new Int32Array(depositOwners) : undefined,
          roads:
            reset || this.previousRoadRevision !== source.expansion.roadRevision
              ? source.expansion.roads
              : undefined,
        }
      : undefined;
    this.previousRoadRevision = source.expansion?.roadRevision ?? -1;
    return {
      reset,
      tick: source.tick,
      width: source.width,
      height: source.height,
      tiles: new Uint32Array(tileChanges),
      squads,
      orders,
      buildingChanges: new Int32Array(changed),
      removedBuildings: new Int32Array(removed),
      players: source.players.map((p) => ({ ...p })),
      expansion,
      squadDetails: source.expansion
        ? source.squads.map((s) => ({
            id: s.id,
            definitionId: s.definitionId,
            xp: s.xp,
            deploymentTicks: s.deploymentTicks,
            nextAttackTick: s.nextAttackTick,
            lastAttackTick: s.lastAttackTick,
            refit: s.refit,
            charge: s.charge,
            chargeReadyTick: s.chargeReadyTick,
            structureTarget: s.structureTarget,
          }))
        : undefined,
      buildingDetails: source.expansion
        ? source.buildings.map((b) => ({
            id: b.id,
            buildTicks: b.buildTicks,
            age: b.age,
            health: b.health,
            maxHealth: b.maxHealth,
            nextAttackTick: b.nextAttackTick,
            launchReadyTick: b.launchReadyTick,
          }))
        : undefined,
      ships: source.ships.map((s) => ({
        id: s.id,
        playerId: s.playerId,
        kind: s.kind,
        x: s.x,
        y: s.y,
        health: s.health,
        destination: s.destination,
        waypoints: [...s.waypoints],
        fighting: s.fighting,
        boarding: s.boarding
          ? { ...s.boarding, squadIds: [...s.boarding.squadIds] }
          : null,
        definitionId: s.definitionId,
        xp: s.xp,
        refit: s.refit,
        attackTargetId: s.attackTargetId,
        lastPlanTick: s.lastPlanTick,
        nextAttackTick: s.nextAttackTick,
        patrolTile: s.patrolTile,
        repairPortId: s.repairPortId,
        repairState: s.repairState,
      })),
      volleys: source.volleys.map((v) => ({ ...v })),
      winner: source.winner,
      combatTicks: source.combatTicks,
    };
  }
}

export function snapshotTransfers(packet: SnapshotPacket): ArrayBuffer[] {
  return [
    packet.tiles,
    packet.squads,
    packet.orders,
    packet.buildingChanges,
    packet.removedBuildings,
  ].map((array) => array.buffer as ArrayBuffer);
}

export class SnapshotDecoder {
  private roads: Uint32Array = new Uint32Array();
  private deposits: NonNullable<Snapshot["expansion"]>["deposits"] = [];
  private readonly depositsById = new Map<number, NonNullable<Snapshot["expansion"]>["deposits"][number]>();
  private owners = new Uint8Array();
  private claims = new Uint8Array();
  private progress = new Uint8Array();
  private readonly buildings = new Map<number, Building>();
  decode(packet: SnapshotPacket,copyArrays=true,includeChangedTiles=true): Snapshot {
    if (packet.reset) {
      this.roads = new Uint32Array();
      this.deposits = [];
      this.depositsById.clear();
      const size = packet.width * packet.height;
      this.owners = new Uint8Array(size);
      this.claims = new Uint8Array(size);
      this.progress = new Uint8Array(size);
      this.buildings.clear();
    }
    const changedTiles = !packet.reset && includeChangedTiles ? new Uint32Array(packet.tiles.length / 2) : undefined;
    for (let at = 0; at < packet.tiles.length; at += 2) {
      const tile = packet.tiles[at],
        value = packet.tiles[at + 1];
      if (changedTiles) changedTiles[at / 2] = tile;
      this.owners[tile] = value & 255;
      this.claims[tile] = (value >>> 8) & 255;
      this.progress[tile] = (value >>> 16) & 255;
    }
    for (const id of packet.removedBuildings) this.buildings.delete(id);
    for (
      let at = 0;
      at < packet.buildingChanges.length;
      at += BUILDING_STRIDE
    ) {
      const b = packet.buildingChanges;
      this.buildings.set(b[at], {
        id: b[at],
        playerId: b[at + 1],
        type: BUILDING_TYPES[b[at + 2]],
        tile: b[at + 3],
        remainingTicks: b[at + 4],
      });
    }
    const squads: Snapshot["squads"] = [];
    for (let at = 0; at < packet.squads.length; at += SQUAD_STRIDE) {
      const s = packet.squads,
        offset = s[at + 12],
        count = s[at + 13];
      const queuedOrders: Order[] = [];
      for (let i = 1; i < count; i++)
        queuedOrders.push(
          readOrder(packet.orders, (offset + i) * ORDER_STRIDE),
        );
      squads.push({
        id: s[at],
        playerId: s[at + 1],
        x: s[at + 2],
        y: s[at + 3],
        troops: s[at + 4],
        kind: SQUAD_TYPES[s[at + 5]],
        embarkedOn: s[at + 6] < 0 ? null : s[at + 6],
        lastCombatTick: s[at + 7],
        moved: !!s[at + 8],
        firingCharge: s[at + 9],
        fighting: !!s[at + 10],
        combatTargetId: s[at + 11] < 0 ? null : s[at + 11],
        order: readOrder(packet.orders, offset * ORDER_STRIDE),
        queuedOrders,
      });
    }
    const details = new Map(packet.squadDetails?.map((s) => [s.id, s]));
    for (const s of squads) Object.assign(s, details.get(s.id));
    for (const b of packet.buildingDetails ?? [])
      Object.assign(this.buildings.get(b.id) ?? {}, b);
    if (packet.expansion?.roads) this.roads = packet.expansion.roads;
    if (packet.expansion?.deposits) {
      this.deposits = packet.expansion.deposits.map(d => ({...d}));
      this.depositsById.clear();
      for (const deposit of this.deposits) this.depositsById.set(deposit.id, deposit);
    }
    const owners = packet.expansion?.depositOwners;
    if (owners) for (let at = 0; at < owners.length; at += 2) {
      const deposit = this.depositsById.get(owners[at]);
      if (!deposit) throw new Error("Resource ownership delta has no baseline fact");
      deposit.owner = owners[at + 1];
    }
    return {
      tick: packet.tick,
      width: packet.width,
      height: packet.height,
      owners: copyArrays ? this.owners.slice() : this.owners,
      claims: copyArrays ? this.claims.slice() : this.claims,
      progress: copyArrays ? this.progress.slice() : this.progress,
      // A reset must initialize presentation caches, including neutral tiles.
      changedTiles: packet.reset ? undefined : changedTiles,
      squads,
      players: packet.players,
      ships: packet.ships,
      buildings: Array.from(this.buildings.values()),
      volleys: packet.volleys,
      winner: packet.winner,
      combatTicks: packet.combatTicks,
      expansion: packet.expansion
        ? { ...packet.expansion, roads: this.roads, deposits: copyArrays ? this.deposits.map(d => ({...d})) : this.deposits }
        : undefined,
    };
  }
}
