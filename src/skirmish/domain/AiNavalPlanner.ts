import { FIXED, type Player, type Ship } from "../Protocol";
import { personalityOf } from "../content/AiPersonalities";
import { VESSEL, VESSELS } from "../content/Units";
import { affordableAiCost } from "./AiBudgetLedger";
import type { AiEconomicDirector } from "./AiEconomicDirector";
import { AGES, type VesselDefinition } from "./Definitions";
import type { Expansion } from "./Expansion";
import { vesselEffects } from "./ResearchEffects";

export type FleetState =
  | "assess"
  | "fund"
  | "assemble"
  | "stage"
  | "execute"
  | "recover"
  | "complete"
  | "abort";
interface Assessment {
  phase: "buildings" | "ships" | "jobs";
  cursor?: number | null;
  port?: number;
  portDistance: number;
  anchor?: number;
  members: number[];
  enemyPower: number;
  target?: number;
  targetDistance: number;
  futurePower: number;
  recoveringPower?: number;
}
export interface AiFleetMission {
  id: string;
  playerId: number;
  generation: number;
  objective: "defend-port";
  sea: number;
  state: FleetState;
  reason: string;
  createdTick: number;
  deadline: number;
  nextAssessment: number;
  port?: number;
  anchor?: number;
  target?: number;
  members: number[];
  recovering?: number[];
  purchases: number;
  assessment?: Assessment;
}
/** Integer rate proxy based on authored, researched attack and current health.
 * It is a planning comparison, never an alternative combat damage rule. */
export function navalPower(vessel: VesselDefinition, health: number): number {
  const attack = vessel.attack;
  if (!attack?.targets.includes("ship") || health <= 0) return 0;
  const fraction = Math.min(1000, Math.floor((health * 1000) / vessel.health));
  const range = Math.max(FIXED, attack.range);
  return Math.floor(
    (attack.damage * fraction * Math.min(range, 16 * FIXED)) /
      (Math.max(1, attack.reloadTicks) * FIXED),
  );
}
export function navalReady(ship: Ship, vessel: VesselDefinition): boolean {
  return (
    ship.kind === "warship" &&
    ship.health * 5 >= vessel.health * 3 &&
    !ship.refit &&
    !ship.boarding &&
    !ship.shoreTransfer &&
    (!ship.repairState || ["idle", "patrolling"].includes(ship.repairState))
  );
}
/** Persistent port-defense/concentration missions. Fact enumeration is resumed
 * one record per charged unit. Domain handlers retain payment and movement.
 * Landing, escort and coastal bombardment are separate subsequent objectives. */
export class AiNavalPlanner {
  readonly missions = new Map<number, AiFleetMission>();
  private readonly funding = new Map<
    string,
    {
      purchases: number;
      vesselPower: number;
      enemyPower: number;
      gold: number;
      quietSince?: number;
    }
  >();
  private cursor = 0;
  private serial = 0;
  readonly diagnostics = { work: 0, transitions: 0, commands: 0, rejected: 0 };
  constructor(
    private readonly expansion: Expansion,
    private readonly economy: AiEconomicDirector,
  ) {}
  enabled(player: Player): boolean {
    return (
      this.economy.enabled(player) &&
      this.expansion.world.options?.aiNaval === true &&
      this.expansion.world.options.deferredPlanning === true
    );
  }
  checkpoint() {
    return structuredClone({
      missions: [...this.missions],
      funding: [...this.funding],
      cursor: this.cursor,
      serial: this.serial,
    });
  }
  restore(saved: ReturnType<AiNavalPlanner["checkpoint"]>): void {
    this.missions.clear();
    for (const [id, mission] of structuredClone(saved.missions))
      this.missions.set(id, mission);
    this.funding.clear();
    for (const [key, evidence] of structuredClone(saved.funding ?? []))
      this.funding.set(key, evidence);
    this.cursor = saved.cursor;
    this.serial = saved.serial;
  }
  release(playerId: number): void {
    const mission = this.missions.get(playerId);
    if (mission) {
      this.economy.assets.release(mission.id);
      this.economy.ledger.release(mission.id);
    }
    this.missions.delete(playerId);
  }
  private transition(
    m: AiFleetMission,
    state: FleetState,
    reason: string,
  ): void {
    if (m.state !== state || m.reason !== reason)
      this.diagnostics.transitions++;
    m.state = state;
    m.reason = reason;
    if (state !== "fund") this.economy.ledger.release(m.id);
    if (state === "complete" || state === "abort") {
      const { world } = this.expansion;
      const owned = [...m.members, ...(m.recovering ?? [])].filter((id) => {
        const ship = world.ship(id);
        return (
          ship &&
          navalReady(ship, this.expansion.vessel(ship)) &&
          this.economy.assets.owns(`ship:${id}`, m.id)
        );
      });
      // Fence any still-pending replacement voyage before relinquishing its
      // controller. Recovery tasks retain their normal movement ownership.
      if (owned.length)
        world.applyCommand({
          type: "stop-ships",
          playerId: m.playerId,
          shipIds: owned,
        });
      this.economy.assets.release(m.id);
      this.economy.ledger.release(m.id);
      m.assessment = undefined;
      m.nextAssessment = this.expansion.world.tick + 400;
    }
  }
  step(budget = 32): number {
    const { world } = this.expansion;
    this.diagnostics.work = 0;
    if (!this.economy.navalFacts.ready || !world.players.length || budget <= 0)
      return 0;
    // One faction per tick; entity work inside it shares one fixed allowance.
    let player: Player | undefined;
    for (let n = 0; n < world.players.length; n++) {
      const candidate = world.players[this.cursor++ % world.players.length];
      if (this.enabled(candidate)) {
        player = candidate;
        break;
      }
    }
    if (!player) return 0;
    let m = this.missions.get(player.id);
    if (m && m.generation !== world.aiGeneration(player.id)) {
      this.release(player.id);
      m = undefined;
    }
    if (m && ["abort", "complete"].includes(m.state)) {
      if (world.tick < m.nextAssessment) return 0;
      this.release(player.id);
      m = undefined;
    }
    if (!m) {
      const sea = this.economy.navalFacts.firstSea(player.id);
      if (!sea) return 0;
      m = {
        id: `fleet:${player.id}:${++this.serial}`,
        playerId: player.id,
        generation: world.aiGeneration(player.id),
        objective: "defend-port",
        sea,
        state: "assess",
        reason: "selecting an owned gathering port",
        createdTick: world.tick,
        deadline: world.tick + 2400,
        nextAssessment: world.tick,
        members: [],
        recovering: [],
        purchases: 0,
      };
      this.missions.set(player.id, m);
    }
    if (world.tick >= m.deadline) {
      this.transition(m, "abort", "mission deadline expired");
      return 0;
    }
    const livePort = m.port === undefined ? undefined : world.building(m.port);
    if (
      m.port !== undefined &&
      (!livePort ||
        livePort.playerId !== player.id ||
        world.owners[livePort.tile] !== player.id ||
        (livePort.health ?? 1) <= 0)
    ) {
      this.transition(m, "abort", "gathering port lost");
      return 0;
    }
    if (!m.assessment && world.tick < m.nextAssessment) return 0;
    m.assessment ??= {
      phase: "buildings",
      portDistance: Infinity,
      members: [],
      enemyPower: 0,
      targetDistance: Infinity,
      futurePower: 0,
    };
    const a = m.assessment;
    let used = 0;
    while (used < budget && m.assessment) {
      used++;
      const read =
        a.phase === "buildings"
          ? this.economy.navalFacts.readOwnedBuilding(player.id, a.cursor)
          : this.economy.navalFacts.readSea(a.phase, m.sea, a.cursor);
      a.cursor = read.next;
      if (read.invalid) {
        m.assessment = undefined;
        m.nextAssessment = world.tick;
        this.transition(m, "assess", "fact cursor invalidated");
        break;
      }
      const value = read.value;
      if (value) {
        if ("type" in value && a.phase === "buildings") {
          if (
            value.type === "port" &&
            (m.port === undefined || value.id === m.port) &&
            value.playerId === player.id &&
            world.owners[value.tile] === player.id &&
            !value.remainingTicks &&
            (value.health ?? 1) > 0
          ) {
            const distance = world.map.euclideanDistSquared(
              value.tile,
              player.base,
            );
            if (
              distance < a.portDistance ||
              (distance === a.portDistance && value.id < (a.port ?? Infinity))
            ) {
              const anchor = world.map
                .neighbors(value.tile)
                .find((t) => world.waterPaths.walkable(t));
              if (
                anchor !== undefined &&
                world.waterPaths.component[anchor] > 0
              ) {
                a.port = value.id;
                a.anchor = anchor;
                a.portDistance = distance;
              }
            }
          }
        } else if (
          "destination" in value &&
          a.phase === "ships" &&
          a.anchor !== undefined
        ) {
          const ship = value,
            definition = this.expansion.vessel(ship);
          if (
            ship.playerId === player.id &&
            navalReady(ship, definition) &&
            (!this.economy.assets.held(`ship:${ship.id}`) ||
              this.economy.assets.owns(`ship:${ship.id}`, m.id))
          ) {
            a.members.push(ship.id);
            // A bounded strongest fleet; unrelated ships remain available.
            a.members.sort((x, y) => {
              const sx = world.ship(x),
                sy = world.ship(y);
              return (
                (sy ? navalPower(this.expansion.vessel(sy), sy.health) : 0) -
                  (sx ? navalPower(this.expansion.vessel(sx), sx.health) : 0) ||
                x - y
              );
            });
            a.members.length = Math.min(8, a.members.length);
          } else if (
            ship.playerId === player.id &&
            this.recovering(ship, m.sea)
          ) {
            a.recoveringPower =
              (a.recoveringPower ?? 0) +
              navalPower(definition, definition.health);
          } else if (
            ship.health > 0 &&
            this.expansion.diplomacy.hostile(player.id, ship.playerId)
          ) {
            const distance = world.map.euclideanDistSquared(
              world.tileOf(ship),
              a.anchor,
            );
            if (distance <= 32 ** 2) {
              this.expansion.operations.threatened(player.id, ship.playerId, a.anchor);
              a.enemyPower += navalPower(definition, ship.health);
              if (
                distance < a.targetDistance ||
                (distance === a.targetDistance &&
                  ship.id < (a.target ?? Infinity))
              ) {
                a.target = ship.id;
                a.targetDistance = distance;
              }
            }
          }
        } else if (
          "category" in value &&
          a.phase === "jobs" &&
          value.playerId === player.id
        ) {
          const definition = VESSEL.get(value.definitionId ?? ""),
            port = world.building(value.buildingId);
          if (
            definition?.kind === "warship" &&
            port?.playerId === player.id &&
            world.owners[port.tile] === player.id &&
            (port.health ?? 1) > 0
          ) {
            const effective = vesselEffects(
              definition,
              this.expansion.progression.states[player.id].completed,
            );
            a.futurePower += navalPower(effective, effective.health);
          }
        }
      }
      if (read.next === null) {
        if (a.phase === "buildings") {
          if (a.port === undefined) {
            this.transition(m, "abort", "no usable port in this sea");
            break;
          }
          a.phase = "ships";
          m.sea = world.waterPaths.component[a.anchor!];
          a.cursor = undefined;
        } else if (a.phase === "ships") {
          a.phase = "jobs";
          a.cursor = undefined;
        } else {
          this.applyAssessment(player, m, a);
          m.assessment = undefined;
          m.nextAssessment = world.tick + 100;
        }
      }
    }
    this.diagnostics.work = used;
    return used;
  }
  private applyAssessment(
    player: Player,
    m: AiFleetMission,
    a: Assessment,
  ): void {
    const { world } = this.expansion;
    m.port = a.port;
    m.anchor = a.anchor;
    m.target = a.target;
    const port = world.building(a.port!);
    if (
      !port ||
      port.type !== "port" ||
      port.remainingTicks > 0 ||
      port.playerId !== player.id ||
      world.owners[port.tile] !== player.id ||
      (port.health ?? 1) <= 0 ||
      this.portSea(port.tile) !== m.sea ||
      a.anchor === undefined ||
      world.waterPaths.component[a.anchor] !== m.sea
    ) {
      this.transition(
        m,
        "abort",
        "gathering port invalidated during assessment",
      );
      return;
    }
    const ships = a.members
      .map((id) => world.ship(id))
      .filter(
        (s): s is Ship =>
          !!s &&
          s.playerId === player.id &&
          world.waterPaths.component[world.tileOf(s)] === m.sea &&
          navalReady(s, this.expansion.vessel(s)),
      );
    const readyPower = ships.reduce(
      (power, s) => power + navalPower(this.expansion.vessel(s), s.health),
      0,
    );
    const target = a.target === undefined ? undefined : world.ship(a.target);
    // Live hostility/sea checks fence an assessment spanning several ticks.
    if (
      a.target !== undefined &&
      (!target ||
        target.health <= 0 ||
        !this.expansion.diplomacy.hostile(player.id, target.playerId) ||
        world.waterPaths.component[world.tileOf(target)] !== m.sea ||
        world.map.euclideanDistSquared(world.tileOf(target), a.anchor) >
          32 ** 2)
    ) {
      this.transition(m, "assess", "target legality changed");
      const held = m.members
        .map((id) => world.ship(id))
        .filter(
          (ship): ship is Ship =>
            !!ship &&
            ship.playerId === m.playerId &&
            navalReady(ship, this.expansion.vessel(ship)) &&
            world.waterPaths.component[world.tileOf(ship)] === m.sea &&
            this.economy.assets.owns(`ship:${ship.id}`, m.id),
        );
      if (held.length) this.sail(m, held, a.anchor);
      return;
    }
    const required = Math.ceil(
      (a.enemyPower * (personalityOf(player).id === "admiral" ? 115 : 130)) /
        100,
    );
    const enough = readyPower > 0 && readyPower >= required;
    const evidence = this.funding.get(`${player.id}:${m.sea}`);
    if (evidence) {
      if (!a.enemyPower) {
        evidence.quietSince ??= world.tick;
        if (world.tick - evidence.quietSince >= 400)
          this.funding.delete(`${player.id}:${m.sea}`);
      } else evidence.quietSince = undefined;
    }
    const future = a.futurePower + (a.recoveringPower ?? 0);
    if (!enough && readyPower + future < Math.max(1, required))
      this.fund(
        player,
        m,
        port.id,
        required,
        readyPower + future,
        a.enemyPower,
      );
    else if (!enough)
      this.transition(
        m,
        "assemble",
        "paid ships are still training or recovering",
      );
    if (!ships.length) return;
    const recovering = [...new Set([...m.members, ...(m.recovering ?? [])])]
      .map((id) => world.ship(id))
      .filter(
        (s): s is Ship =>
          !!s &&
          s.playerId === player.id &&
          this.recovering(s, m.sea) &&
          this.economy.assets.owns(`ship:${s.id}`, m.id),
      )
      .slice(0, 8);
    const roster = [...ships, ...recovering];
    const requests = roster.map((s) => ({
      asset: `ship:${s.id}` as const,
      playerId: player.id,
      generation: m.generation,
      controller: m.id,
      priority: recovering.some((ship) => ship.id === s.id)
        ? ("recovery" as const)
        : ("operation" as const),
      createdTick: m.createdTick,
      expiresTick: m.deadline,
    }));
    if (!this.economy.assets.acquire(requests)) {
      this.transition(m, "assess", "fleet movement ownership changed");
      return;
    }
    const selected = new Set(roster.map((s) => `ship:${s.id}` as const));
    const dropped = [...m.members, ...(m.recovering ?? [])].filter(
      (id) =>
        !selected.has(`ship:${id}`) &&
        this.economy.assets.owns(`ship:${id}`, m.id) &&
        world.ship(id)?.playerId === player.id &&
        navalReady(world.ship(id)!, this.expansion.vessel(world.ship(id)!)),
    );
    if (dropped.length)
      world.applyCommand({
        type: "stop-ships",
        playerId: player.id,
        shipIds: dropped,
      });
    this.economy.assets.retain(m.id, selected);
    m.members = ships.map((s) => s.id);
    m.recovering = recovering.map((s) => s.id);
    const gathered = ships.every(
      (s) =>
        world.map.euclideanDistSquared(world.tileOf(s), a.anchor!) <= 6 ** 2,
    );
    const concentrated = ships.every(
      (s) =>
        world.map.euclideanDistSquared(
          world.tileOf(s),
          world.tileOf(ships[0]),
        ) <=
        6 ** 2,
    );
    if (
      enough &&
      target &&
      (gathered || (m.state === "execute" && concentrated))
    ) {
      this.transition(
        m,
        "execute",
        "concentrated fleet intercepting a port threat",
      );
      this.sail(m, ships, world.tileOf(target));
    } else {
      if (enough && !target)
        this.transition(m, "stage", "holding a stable port defense anchor");
      else if (enough)
        this.transition(m, "stage", "concentrating before interception");
      this.sail(m, ships, a.anchor!);
    }
  }
  private sail(m: AiFleetMission, ships: Ship[], tile: number): void {
    const { world } = this.expansion;
    if (
      ships.every(
        (s) =>
          s.destination === tile ||
          (s.destination === null &&
            world.map.euclideanDistSquared(world.tileOf(s), tile) <= 3 ** 2),
      )
    )
      return;
    const rejection = world.applyCommand({
      type: "sail",
      playerId: m.playerId,
      shipIds: ships.map((s) => s.id),
      tile,
    });
    this.diagnostics.commands++;
    if (rejection) {
      this.diagnostics.rejected++;
      this.transition(m, "assess", `sail rejected: ${rejection}`);
    }
  }
  private portSea(tile: number): number | undefined {
    const { world } = this.expansion;
    const berth = world.map
      .neighbors(tile)
      .find((t) => world.waterPaths.walkable(t));
    return berth === undefined ? undefined : world.waterPaths.component[berth];
  }
  private recovering(ship: Ship, sea: number): boolean {
    const { world } = this.expansion,
      port =
        ship.repairPortId === undefined || ship.repairPortId === null
          ? undefined
          : world.building(ship.repairPortId);
    return (
      ship.kind === "warship" &&
      ship.health > 0 &&
      !ship.refit &&
      !ship.boarding &&
      !ship.shoreTransfer &&
      [
        "returning-to-dock",
        "waiting-for-dock",
        "repairing",
        "returning-to-patrol",
      ].includes(ship.repairState ?? "") &&
      world.waterPaths.component[world.tileOf(ship)] === sea &&
      !!port &&
      port.type === "port" &&
      !port.remainingTicks &&
      port.playerId === ship.playerId &&
      world.owners[port.tile] === ship.playerId &&
      (port.health ?? 1) > 0 &&
      this.portSea(port.tile) === sea
    );
  }
  private fund(
    player: Player,
    m: AiFleetMission,
    portId: number,
    required: number,
    future: number,
    enemyPower: number,
  ): void {
    const { world, progression, supply } = this.expansion,
      port = world.building(portId)!;
    if (m.purchases >= 2) {
      this.transition(
        m,
        "recover",
        "purchase allowance exhausted; defending while reassessing",
      );
      return;
    }
    const definition = VESSELS.slice()
      .reverse()
      .find(
        (v) =>
          v.kind === "warship" &&
          progression.has(player.id, v.technologyId) &&
          AGES.indexOf(v.age) <= AGES.indexOf(port.age ?? "StoneAge"),
      );
    if (!definition) {
      this.transition(
        m,
        "fund",
        "no researched vessel for the gathering port tier",
      );
      return;
    }
    const researched = vesselEffects(
        definition,
        progression.states[player.id].completed,
      ),
      power = navalPower(researched, researched.health),
      key = `${player.id}:${m.sea}`;
    const evidence = this.funding.get(key);
    if (evidence && evidence.purchases >= 2) {
      // A deadline/new mission is not new evidence. Reopen investment only
      // after a material technology advantage or a weaker hostile fleet.
      if (
        power * 4 >= evidence.vesselPower * 5 ||
        (evidence.enemyPower > 0 && enemyPower * 4 <= evidence.enemyPower * 3)
      ) {
        evidence.purchases = 0;
      } else {
        this.transition(
          m,
          "recover",
          "same-sea spending exhausted without improved combat evidence",
        );
        return;
      }
    }
    const remaining = Math.max(
      0,
      Math.min(2 - m.purchases, 2 - (this.funding.get(key)?.purchases ?? 0)),
    );
    if (future + remaining * power < required) {
      this.transition(
        m,
        "recover",
        "bounded recruitment cannot contest this fleet; retaining port defense",
      );
      return;
    }
    const liquid = {
        gold: player.gold,
        reserves: player.reserves,
        items: supply.inventories[player.id],
      },
      available = this.economy.ledger.spendable(player.id, liquid, m.id),
      cost = definition.cost;
    const amounts = {
      gold: Math.min(available.gold ?? 0, cost.gold ?? 0),
      reserves: Math.min(available.reserves ?? 0, cost.reserves ?? 0),
      items: Object.fromEntries(
        Object.entries(cost.items ?? {}).map(([id, n]) => [
          id,
          Math.min(n, available.items?.[id] ?? 0),
        ]),
      ),
    };
    this.transition(m, "fund", "saving for a same-sea defender");
    if (
      !this.economy.ledger.tryReserve(
        {
          id: m.id,
          claimant: m.id,
          playerId: player.id,
          generation: m.generation,
          priority: "growth",
          amounts,
          createdTick: m.createdTick,
          progressTick: world.tick,
          expiresTick: m.deadline,
        },
        liquid,
      ) ||
      !affordableAiCost(available, cost)
    )
      return;
    const rejection = world.applyCommand({
      type: "recruit-ship",
      playerId: player.id,
      buildingId: port.id,
      shipType: "warship",
      definitionId: definition.id,
    });
    this.diagnostics.commands++;
    this.economy.ledger.release(m.id);
    if (rejection) {
      this.diagnostics.rejected++;
      this.transition(m, "assess", `recruit rejected: ${rejection}`);
    } else {
      m.purchases++;
      const record = this.funding.get(key) ?? {
        purchases: 0,
        vesselPower: power,
        enemyPower,
        gold: 0,
      };
      record.purchases++;
      record.vesselPower = power;
      record.enemyPower = enemyPower;
      record.gold += definition.cost.gold ?? 0;
      this.funding.set(key, record);
      this.transition(m, "assemble", "same-sea defender paid and training");
    }
  }
}
