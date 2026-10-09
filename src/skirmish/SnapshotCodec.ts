import type { TileChangeJournal } from "./TileChangeJournal";
import type { EntityChangeJournal } from "./EntityChangeJournal";
import type { ReplicatedEntities } from "./ReplicatedEntities";
import type {
  Building,
  BuildingType,
  Order,
  Snapshot,
  SnapshotPacket,
  SquadType,
} from "./Protocol";
import { BUILDING_RULES, MAX_FACTION_SHIPS } from "./Rules";
import { MAX_SQUADS } from "./Protocol";
import { packSnapshotDetails, unpackSnapshotDetails, validateSnapshotDetails } from "./SnapshotDetails";

export type SnapshotSource = Omit<Snapshot, "buildings" | "squads" | "ships"> & {
  readonly buildings: readonly Building[];
  readonly squads: readonly Snapshot["squads"][number][];
  readonly ships: readonly Snapshot["ships"][number][];
};

export const SNAPSHOT_LAYOUT = Object.freeze({ squadStride: 14, orderStride: 6, buildingStride: 5 });
const { squadStride: SQUAD_STRIDE, orderStride: ORDER_STRIDE, buildingStride: BUILDING_STRIDE } = SNAPSHOT_LAYOUT;
const SQUAD_TYPES: SquadType[] = ["infantry", "archer", "cavalry"];
const BUILDING_TYPES = Object.keys(BUILDING_RULES) as BuildingType[];
const ORDER_TYPES: Order["type"][] = [
  "hold",
  "replenish",
  "move",
  "attack",
];

/** Validate the new family before either decoder or presentation obligations
 * mutate. Retained-memory qualification remains governed by StateLimits. */
export function validateBarrierChanges(packet: SnapshotPacket): void {
  const changes = packet.barrierChanges;
  if (!changes) return;
  if (typeof changes.reset !== "boolean" || !Array.isArray(changes.rows) || !(changes.removed instanceof Int32Array))
    throw new Error("Invalid canonical barrier changes");
  const seen = new Set<number>(), size = packet.width * packet.height;
  for (const id of changes.removed) if (!Number.isSafeInteger(id) || id < 0) throw new Error("Invalid canonical barrier identity");
  for (const wall of changes.rows) {
      if (wall.kind !== undefined && wall.kind !== "trench") throw new Error("Invalid canonical barrier kind");
    if (!Number.isSafeInteger(wall.id) || wall.id < 0 || seen.has(wall.id) ||
      !Number.isSafeInteger(wall.playerId) || wall.playerId < 0 || wall.playerId >= 255 ||
      !Number.isFinite(wall.health) || !Number.isFinite(wall.maxHealth) || !Number.isFinite(wall.remainingTicks) ||
      !Array.isArray(wall.tiles) || wall.tiles.some((tile: number) => !Number.isSafeInteger(tile) || tile < 0 || tile >= size))
      throw new Error("Invalid canonical barrier record");
    seen.add(wall.id);
  }
  const states = new Set<number>();
  if (changes.states !== undefined && !Array.isArray(changes.states)) throw new Error("Invalid canonical barrier states");
  for (const state of changes.states ?? []) {
    if (!Number.isSafeInteger(state.id) || state.id < 0 || states.has(state.id) ||
      !Number.isFinite(state.health) || !Number.isFinite(state.remainingTicks)) throw new Error("Invalid canonical barrier state");
    states.add(state.id);
  }
}

function writeOrder(output: Int32Array, at: number, order: Order) {
  output[at] = ORDER_TYPES.indexOf(order.type);
  if (order.type === "move") output[at + 1] = order.tile;
  if (order.type === "attack") output[at + 2] = order.targetId;
  if (order.type === "move" && order.x !== undefined) {
    output[at + 3] = order.x;
    output[at + 4] = order.y!;
    output[at + 5] = 1;
  }
  if ((order.type === "move" || order.type === "hold") && order.facing !== undefined) {
    output[at+2]=Math.round(order.facing*1e6);
    output[at+5]|=2;
  }
}
function readOrder(input: Int32Array, at: number): Order {
  const type = ORDER_TYPES[input[at]];
  if (type === "attack") return { type, targetId: input[at + 2] };
  if (type === "move")
    return {
      type,
      tile: input[at + 1],
      ...(input[at + 5] & 1 ? { x: input[at + 3], y: input[at + 4] } : {}),
      ...(input[at + 5] & 2 ? { facing: input[at+2]/1e6 } : {}),
    };
  return type === "hold" && (input[at+5]&2) ? {type, facing:input[at+2]/1e6} : { type };
}

// Worker adapter: only presentation fields leave the authoritative domain.
// Numeric buffers are transferred; ownership/construction changes are deltas.
export class SnapshotEncoder {
  private journal?: TileChangeJournal;
  private journalRevision = 0;
  readonly diagnostics = { tileReads: 0, squadReads: 0, shipReads: 0, buildingReads: 0,
    resourceReads: 0, resourceSignatureRows: 0, entityFallbacks: 0, barrierReads: 0 };
  private entityCursors?: {squads: EntityChangeJournal; ships: EntityChangeJournal; buildings: EntityChangeJournal;
    squadRevision: number; shipRevision: number; buildingRevision: number};
  private resourceJournal?: EntityChangeJournal;
  private resourceCursor = 0;
  private resourceGeometryRevision = -1;
  private barrierJournal?: EntityChangeJournal;
  private barrierCursor = 0;
  private selectEntities(source: SnapshotSource, facts: ReplicatedEntities | undefined, reset: boolean) {
    const previous = this.entityCursors;
    const squadChanges = !reset && facts && previous?.squads === facts.squads.journal
      ? facts.squads.journal.since(previous.squadRevision) : undefined;
    const shipChanges = !reset && facts && previous?.ships === facts.ships.journal
      ? facts.ships.journal.since(previous.shipRevision) : undefined;
    const buildingChanges = !reset && facts && previous?.buildings === facts.buildings.journal
      ? facts.buildings.journal.since(previous.buildingRevision) : undefined;
    const full = !squadChanges || !shipChanges || !buildingChanges;
    if (facts && full && !reset) this.diagnostics.entityFallbacks++;
    const dirtyRows = <T extends {readonly id: number}>(changes: {id: number; removed: boolean}[],
      lookup: (id: number) => T | undefined) => {
      const rows: T[] = [], removed: number[] = [];
      for (const change of changes) {
        const row = lookup(change.id);
        if (change.removed || !row) removed.push(change.id);
        if (row) rows.push(row);
      }
      return {rows, removed};
    };
    const squads = full ? {rows: source.squads, removed: []} : dirtyRows(squadChanges, facts!.squads.byId);
    const ships = full ? {rows: source.ships, removed: []} : dirtyRows(shipChanges, facts!.ships.byId);
    const buildings = full ? {rows: source.buildings, removed: []} : dirtyRows(buildingChanges, facts!.buildings.byId);
    this.entityCursors = facts ? {squads: facts.squads.journal, ships: facts.ships.journal,
      buildings: facts.buildings.journal, squadRevision: facts.squads.journal.revision,
      shipRevision: facts.ships.journal.revision, buildingRevision: facts.buildings.journal.revision} : undefined;
    this.diagnostics.squadReads = squads.rows.length;
    this.diagnostics.shipReads = ships.rows.length;
    this.diagnostics.buildingReads = buildings.rows.length;
    return {full, squads, ships, buildings};
  }
  // Fresh network clients reset their arrays to zero, so neutral tiles need no wire entry.
  constructor(private readonly sparseBaseline = false) {}
  private metadataIdentity?:object;
  private metadataRevisions:Partial<Record<keyof NonNullable<Snapshot["expansion"]>,number>>={};
  private selectMetadata(source:NonNullable<Snapshot["expansion"]>,facts:ReplicatedEntities|undefined,reset:boolean){
    const metadata=facts?.metadata,full=reset || !metadata || metadata.identity!==this.metadataIdentity;
    const output:Partial<NonNullable<Snapshot["expansion"]>>={};
    for(const key of Object.keys(source) as (keyof typeof source)[]){
      if(key==="roads" || key==="deposits")continue;
      if(key==="barriers" && facts?.barriers && !full)continue;
      const revision=metadata?.revisions[key];
      if(full || revision===undefined || this.metadataRevisions[key]!==revision)Object.assign(output,{[key]:source[key]});
    }
    this.metadataIdentity=metadata?.identity;this.metadataRevisions={...metadata?.revisions};
    return {output,full};
  }
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
  encodeJoinBarrier(source: SnapshotSource, journal?: TileChangeJournal, facts?: ReplicatedEntities): {
    shared: SnapshotPacket;
    baseline: SnapshotPacket;
  } {
    return {
      shared: this.encode(source, journal, facts),
      baseline: new SnapshotEncoder(true).encode(source, journal, facts),
    };
  }
  encode(source: SnapshotSource, journal?: TileChangeJournal, facts?: ReplicatedEntities,
    presentation?: { tiles: Uint32Array; reset: boolean; resourcesChanged?: boolean; roadsChanged?: boolean }): SnapshotPacket {
    const reset =
      presentation?.reset ?? (!this.previousTiles ||
      this.width !== source.width ||
      this.height !== source.height);
    if (reset) {
      this.previousTiles = presentation ? new Uint32Array(0) : new Uint32Array(source.owners.length);
      this.buildings.clear();
      this.width = source.width;
      this.height = source.height;
    }
    const tileChanges: number[] = [];
    const dirtyTiles = !reset && journal && journal === this.journal ? journal.since(this.journalRevision)?.sort((a, b) => a - b) : undefined;
    const count = presentation ? 0 : dirtyTiles?.length ?? source.owners.length;
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
    const selected = this.selectEntities(source, facts, reset);
    if (facts && selected.full) this.buildings.clear();
    for (const id of selected.buildings.removed) this.buildings.delete(id);
    const squads = new Int32Array(selected.squads.rows.length * SQUAD_STRIDE);
    const orderCount = selected.squads.rows.reduce(
      (sum, s) => sum + 1 + s.queuedOrders.length,
      0,
    );
    const orders = new Int32Array(orderCount * ORDER_STRIDE);
    let offset = 0;
    selected.squads.rows.forEach((s, index) => {
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
      live = facts ? undefined : new Set<number>();
    for (const b of selected.buildings.rows) {
      live?.add(b.id);
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
    const removed: number[] = selected.buildings.removed.slice();
    if (live) for (const id of this.buildings.keys())
      if (!live.has(id)) {
        removed.push(id);
        this.buildings.delete(id);
      }
    const resources = facts?.resources;
    const nodes = source.expansion?.deposits ?? [];
    let geometry = this.depositGeometry;
    if (!resources && presentation?.resourcesChanged !== false) {
      this.diagnostics.resourceSignatureRows += nodes.length;
      geometry = nodes.map(d => `${d.id}:${d.tile}:${d.resource}:${d.yieldPerSecond}`).join("|");
    }
    const resourceReset = reset || (presentation ? presentation.resourcesChanged !== false : resources
      ? this.resourceJournal !== resources.journal || this.resourceGeometryRevision !== resources.geometryRevision
      : geometry !== this.depositGeometry || this.resourceJournal !== undefined);
    const changes = !resourceReset && resources && this.resourceJournal === resources.journal
      ? resources.journal.since(this.resourceCursor) : undefined;
    const resourceRows = changes ? changes.flatMap(change => {
      const node = resources!.byId(change.id); return node ? [node] : [];
    }) : presentation?.resourcesChanged === false ? [] : nodes;
    this.diagnostics.resourceReads = resourceRows.length;
    const depositOwners: number[] = [];
    if (resourceReset) this.depositOwners.clear();
    for (const deposit of resourceRows) {
      if (!resourceReset && this.depositOwners.get(deposit.id) !== deposit.owner) depositOwners.push(deposit.id, deposit.owner);
      this.depositOwners.set(deposit.id, deposit.owner);
    }
    this.depositGeometry = geometry;
    this.resourceJournal = resources?.journal;
    this.resourceCursor = resources?.journal.revision ?? 0;
    this.resourceGeometryRevision = resources?.geometryRevision ?? -1;
    const metadata=source.expansion?this.selectMetadata(source.expansion,facts,reset):undefined;
    const barriers = facts?.barriers;
    let barrierChanges: SnapshotPacket["barrierChanges"];
    if (source.expansion && barriers && !metadata!.full) {
      const changes = this.barrierJournal === barriers.journal ? barriers.journal.since(this.barrierCursor) : undefined;
      if (!changes) barrierChanges = { reset: true, rows: source.expansion.barriers, removed: new Int32Array() };
      else if (changes.length) {
        const rows: NonNullable<Snapshot["expansion"]>["barriers"][number][] = [], removed: number[] = [], states: { id: number; health: number; remainingTicks: number }[] = [];
        for (const change of changes) {
          const wall = barriers.byId(change.id);
          if (change.removed || !wall) removed.push(change.id);
          if (wall) {
            if (change.added > this.barrierCursor) rows.push(wall);
            else states.push({ id: wall.id, health: wall.health, remainingTicks: wall.remainingTicks });
          }
        }
        barrierChanges = { reset: false, rows, removed: new Int32Array(removed), states: states.length ? states : undefined };
      }
    }
    this.barrierJournal = barriers?.journal; this.barrierCursor = barriers?.journal.revision ?? 0;
    this.diagnostics.barrierReads = source.expansion ? metadata!.full || !barriers ? source.expansion.barriers.length :
      (barrierChanges?.rows.length ?? 0) + (barrierChanges?.states?.length ?? 0) : 0;
    const expansion = source.expansion
      ? {
          ...metadata!.output,
          deposits: resourceReset ? source.expansion.deposits.map(d => ({...d})) : undefined,
          depositOwners: depositOwners.length ? new Int32Array(depositOwners) : undefined,
          roads:
            reset || (presentation ? presentation.roadsChanged !== false : this.previousRoadRevision !== source.expansion.roadRevision)
              ? source.expansion.roads?.slice()
              : undefined,
        }
      : undefined;
    this.previousRoadRevision = source.expansion?.roadRevision ?? -1;
    return {
      reset,
      barrierChanges,
      entityMode: facts ? (selected.full ? "full" : "delta") : undefined,
      removedSquads: facts && selected.squads.removed.length ? new Int32Array(selected.squads.removed) : undefined,
      removedShips: facts && selected.ships.removed.length ? new Int32Array(selected.ships.removed) : undefined,
      tick: source.tick,
      width: source.width,
      height: source.height,
      tiles: presentation?.tiles ?? new Uint32Array(tileChanges),
      squads,
      orders,
      buildingChanges: new Int32Array(changed),
      removedBuildings: new Int32Array(removed),
      players: source.players.map((p) => ({ ...p })),
      expansion,
      expansionMode:metadata?(metadata.full?"full":"delta"):undefined,
      details: packSnapshotDetails(
        source.expansion ?? selected.squads.rows.some(s => s.planningPaused === true || s.movementStatus !== undefined) ? selected.squads.rows : undefined,
        source.expansion ? selected.buildings.rows : undefined,
        selected.ships.rows, source.volleys,
      ),
      ships: [],
      volleys: [],
      winner: source.winner,
      combatTicks: source.combatTicks,
    };
  }
}

export function snapshotTransfers(packet: SnapshotPacket): ArrayBuffer[] {
  const details = packet.details;
  return [
    packet.tiles, packet.squads, packet.orders, packet.buildingChanges, packet.removedBuildings,
    ...(packet.removedSquads ? [packet.removedSquads] : []),
    ...(packet.removedShips ? [packet.removedShips] : []),
    ...(packet.expansion?.roads ? [packet.expansion.roads] : []),
    ...(packet.expansion?.depositOwners ? [packet.expansion.depositOwners] : []),
    ...(packet.barrierChanges ? [packet.barrierChanges.removed] : []),
    ...(details ? [details.ships, details.volleys, details.ids,
      ...(details.shipAirDefense ? [details.shipAirDefense] : []),
      ...(details.squads ? [details.squads] : []), ...(details.squadMotion ? [details.squadMotion] : []),
      ...(details.buildings ? [details.buildings] : [])] : []),
  ].map((array) => array.buffer as ArrayBuffer);
}

export class SnapshotDecoder {
  private readonly barriers = new Map<number, NonNullable<Snapshot["expansion"]>["barriers"][number]>();
  private expansionMetadata?:Partial<NonNullable<Snapshot["expansion"]>>;
  private roads: Uint32Array = new Uint32Array();
  private readonly squads = new Map<number, Snapshot["squads"][number]>();
  private readonly ships = new Map<number, Snapshot["ships"][number]>();
  private depositGeometryRevision = 0;
  private depositOwnershipRevision = 0;
  private deposits: NonNullable<Snapshot["expansion"]>["deposits"] = [];
  private readonly depositsById = new Map<number, NonNullable<Snapshot["expansion"]>["deposits"][number]>();
  private owners = new Uint8Array();
  private claims = new Uint8Array();
  private progress = new Uint8Array();
  private readonly buildings = new Map<number, Building>();
  validate(packet: SnapshotPacket): void {
    if (packet.details) validateSnapshotDetails(packet.details);
    validateBarrierChanges(packet);
    if (packet.barrierChanges && !this.expansionMetadata && !packet.expansion?.barriers)
      throw new Error("Barrier delta has no metadata baseline");
    const changes = packet.barrierChanges;
    if (changes?.states?.length) {
      const removed = new Set(changes.removed), upserts = new Set(changes.rows.map(wall => wall.id));
      const fresh = packet.expansion?.barriers && new Set(packet.expansion.barriers.map(wall => wall.id));
      for (const state of changes.states)
        if (!upserts.has(state.id) && (changes.reset || removed.has(state.id) || !(fresh ? fresh.has(state.id) : this.barriers.has(state.id))))
          throw new Error("Barrier state has no geometry baseline");
    }
  }
  decode(packet: SnapshotPacket,copyArrays=true,includeChangedTiles=true): Snapshot {
    this.validate(packet);
    const records = packet.details ? unpackSnapshotDetails(packet.details) : packet;
    const full = packet.reset || packet.entityMode !== "delta";
    const checkCapacity = (current: ReadonlyMap<number, unknown>, ids: Iterable<number>,
      removed: Int32Array | undefined, limit: number) => {
      const remove = new Set(removed), added = new Set(ids);
      let count = full ? 0 : current.size;
      if (!full) for (const id of remove) if (current.has(id)) count--;
      for (const id of added) if (full || !current.has(id) || remove.has(id)) count++;
      if (count > limit) throw new Error("Canonical retained units exceed the entity budget");
    };
    const squadIds = function* () {
      for (let at = 0; at < packet.squads.length; at += SQUAD_STRIDE) yield packet.squads[at];
    };
    checkCapacity(this.squads, squadIds(), packet.removedSquads, MAX_SQUADS * 255);
    checkCapacity(this.ships, records.ships.map(ship => ship.id), packet.removedShips, MAX_FACTION_SHIPS * 255);
    if (packet.reset) {
      this.barriers.clear();
      this.expansionMetadata=undefined;
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
    if (packet.reset || packet.entityMode !== "delta") {
      this.squads.clear(); this.ships.clear();
      if (packet.entityMode === "full") this.buildings.clear();
    }
    for (const id of packet.removedSquads ?? []) this.squads.delete(id);
    for (const id of packet.removedShips ?? []) this.ships.delete(id);
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
    const details = new Map(records.squadDetails?.map((s) => [s.id, s]));
    for (const s of squads) { Object.assign(s, details.get(s.id)); this.squads.set(s.id, s); }
    for (const ship of records.ships) this.ships.set(ship.id, packet.details ? ship : structuredClone(ship));
    for (const b of records.buildingDetails ?? [])
      Object.assign(this.buildings.get(b.id) ?? {}, b);
    if(packet.expansion){
      if(packet.expansionMode!=="delta")this.expansionMetadata={};
      if(!this.expansionMetadata)throw new Error("Metadata delta has no baseline");
      for(const key of Object.keys(packet.expansion) as (keyof typeof packet.expansion)[]){
        if(key==="deposits" || key==="depositOwners" || key==="roads" || packet.expansion[key]===undefined)continue;
        Object.assign(this.expansionMetadata,{[key]:structuredClone(packet.expansion[key])});
      }
    }
    if (packet.expansion?.barriers) {
      this.barriers.clear();
      for (const wall of this.expansionMetadata!.barriers!) this.barriers.set(wall.id, wall);
    }
    if (packet.barrierChanges) {
      if (!this.expansionMetadata) throw new Error("Barrier delta has no metadata baseline");
      if (packet.barrierChanges.reset) this.barriers.clear();
      for (const id of packet.barrierChanges.removed) this.barriers.delete(id);
      for (const wall of packet.barrierChanges.rows) this.barriers.set(wall.id, structuredClone(wall));
      for (const state of packet.barrierChanges.states ?? []) Object.assign(this.barriers.get(state.id)!, state);
      this.expansionMetadata.barriers = [...this.barriers.values()];
    }
    if (packet.expansion?.roads) this.roads = packet.expansion.roads;
    if (packet.reset || packet.expansion?.deposits) this.depositGeometryRevision++;
    if (packet.reset || packet.expansion?.deposits || packet.expansion?.depositOwners?.length) this.depositOwnershipRevision++;
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
      squads: copyArrays ? structuredClone([...this.squads.values()]) : [...this.squads.values()],
      players: packet.players,
      ships: copyArrays ? structuredClone([...this.ships.values()]) : [...this.ships.values()],
      buildings: copyArrays ? structuredClone([...this.buildings.values()]) : [...this.buildings.values()],
      volleys: records.volleys,
      winner: packet.winner,
      combatTicks: packet.combatTicks,
      expansion: packet.expansion
        ? { ...(copyArrays?structuredClone(this.expansionMetadata):this.expansionMetadata) as NonNullable<Snapshot["expansion"]>, roads: this.roads, deposits: copyArrays ? this.deposits.map(d => ({...d})) : this.deposits,
          depositGeometryRevision: this.depositGeometryRevision, depositOwnershipRevision: this.depositOwnershipRevision }
        : undefined,
    };
  }
}
