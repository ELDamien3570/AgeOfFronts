import { portWaterTiles } from "../PortWaterAccess";
import { FIXED, type Building, type Player, type Ship, type Squad } from "../Protocol";
import { AI_DOCTRINES } from "../content/AiDoctrines";
import { personalityOf } from "../content/AiPersonalities";
import { VESSELS } from "../content/Units";
import { affordableAiCost } from "./AiBudgetLedger";
import type { AiEconomicDirector } from "./AiEconomicDirector";
import { navalPower, navalReady } from "./AiNavalPlanner";
import { AGES } from "./Definitions";
import type { Expansion } from "./Expansion";
type Phase =
  | "assess"
  | "assemble"
  | "board"
  | "sail"
  | "land"
  | "handoff"
  | "recover"
  | "complete"
  | "abort";
export interface AiTransportMission {
  id: string;
  playerId: number;
  generation: number;
  sea: number;
  port: number;
  target: number;
  phase: Phase;
  since: number;
  deadline: number;
  nextThink: number;
  cursor: number;
  shipCursor?: number | null;
  coastCursor: number;
  roster: number[];
  eligible: number[];
  transports: number[];
  escorts: number[];
  groups: {
    shipId: number;
    members: number[];
    boarded: boolean;
    landed: boolean;
  }[];
  landing?: { landTile: number; waterTile: number };
  recovery?: { landTile: number; waterTile: number };
  enemyPower: number;
  reason: string;
  purchases: number;
  handedOff: boolean;
  initialTroops: number;
  lostTroops: number;
}
/** Strategic policy only: real hulls, leases and cargo, through the existing
 * boarding/voyage/unload commands. No simulated cargo or free ship authority. */
export class AiTransportPlanner {
  readonly missions = new Map<number, AiTransportMission>();
  private cursor = 0;
  private serial = 0;
  private readonly spending = new Map<string, number>();
  private readonly history: {
    id: string;
    playerId: number;
    phase: Phase;
    reason: string;
    tick: number;
    lostTroops: number;
  }[] = [];
  readonly diagnostics = { work: 0, commands: 0, rejected: 0, handoffs: 0 };
  constructor(
    private readonly expansion: Expansion,
    private readonly economy: AiEconomicDirector,
  ) {}
  checkpoint() {
    return structuredClone({
      missions: [...this.missions],
      spending: [...this.spending],
      history: this.history,
      cursor: this.cursor,
      serial: this.serial,
    });
  }
  restore(saved?: ReturnType<AiTransportPlanner["checkpoint"]>): void {
    this.missions.clear();
    this.spending.clear();
    this.history.length = 0;
    this.cursor = saved?.cursor ?? 0;
    this.serial = saved?.serial ?? 0;
    for (const [id, m] of structuredClone(saved?.missions ?? []))
      this.missions.set(id, m);
    for (const [id, n] of saved?.spending ?? []) this.spending.set(id, n);
    this.history.push(...structuredClone(saved?.history ?? []));
  }
  release(playerId: number): void {
    const m = this.missions.get(playerId);
    if (m) {
      this.economy.assets.release(m.id);
      this.economy.ledger.release(m.id);
    }
    this.missions.delete(playerId);
  }
  private transition(
    m: AiTransportMission,
    phase: Phase,
    reason: string,
  ): void {
    if (m.phase !== phase) {
      m.since = this.expansion.world.tick;
      if (phase === "recover") {
        const ids = [...m.transports, ...m.escorts].filter(
          (id) =>
            this.ownShip(m, id) &&
            this.economy.assets.owns(`ship:${id}`, m.id) &&
            !this.ownShip(m, id)!.repairPortId,
        );
        if (ids.length)
          this.command(m, {
            type: "stop-ships",
            playerId: m.playerId,
            shipIds: ids,
          });
      }
    }
    m.phase = phase;
    m.reason = reason;
    if (phase === "complete" || phase === "abort") {
      const { world } = this.expansion;
      m.lostTroops = Math.max(
        0,
        m.initialTroops -
          m.groups
            .flatMap((g) => g.members)
            .reduce(
              (n, id) =>
                n +
                (world.squad(id)?.playerId === m.playerId
                  ? world.squad(id)!.troops
                  : 0),
              0,
            ),
      );
      this.history.push({
        id: m.id,
        playerId: m.playerId,
        phase,
        reason,
        tick: world.tick,
        lostTroops: m.lostTroops,
      });
      if (this.history.length > 128) this.history.shift();
      this.economy.assets.release(m.id);
      this.economy.ledger.release(m.id);
      m.nextThink = world.tick + 600;
    }
  }
  private command(
    m: AiTransportMission,
    command: import("../Protocol").Command,
  ): boolean {
    const rejected = this.expansion.world.applyCommand(command);
    this.diagnostics.commands++;
    if (rejected) {
      this.diagnostics.rejected++;
      m.reason = rejected;
      return false;
    }
    return true;
  }
  private ownShip(m: AiTransportMission, id: number): Ship | undefined {
    const { world } = this.expansion,
      s = world.ship(id);
    return s &&
      s.playerId === m.playerId &&
      s.health > 0 &&
      world.waterPaths.component[world.tileOf(s)] === m.sea
      ? s
      : undefined;
  }
  private cargoCandidate(playerId: number, id: number, port: Building | undefined): Squad | undefined {
    const { world } = this.expansion, squad = world.squad(id);
    return squad && squad.playerId === playerId && squad.troops >= 700 &&
      squad.embarkedOn === null && !squad.refit && !squad.charge && !squad.fighting &&
      squad.order.type === "hold" && !this.expansion.armies.armyOf(id) &&
      !this.economy.assets.held(`squad:${id}`) && port &&
      world.paths.connected(world.tileOf(squad), port.tile) ? squad : undefined;
  }
  private availableHull(m: AiTransportMission, id: number): Ship | undefined {
    const ship = this.ownShip(m, id);
    return ship && ship.health * 5 >= this.expansion.vessel(ship).health * 3 &&
      !ship.refit && !ship.boarding && !ship.shoreTransfer &&
      (!this.economy.assets.held(`ship:${id}`) ||
        ["patrol", "operation"].includes(this.economy.assets.leases.get(`ship:${id}`)!.priority)) ? ship : undefined;
  }
  private sail(m: AiTransportMission, ships: Ship[], tile: number): void {
    const { world } = this.expansion,
      ids = ships
        .filter(
          (s) =>
            !s.refit &&
            !s.boarding &&
            (!s.repairState ||
              ["idle", "patrolling"].includes(s.repairState)) &&
            s.destination !== tile &&
            (s.destination !== null ||
              world.map.euclideanDistSquared(world.tileOf(s), tile) > 4),
        )
        .map((s) => s.id);
    if (ids.length)
      this.command(m, {
        type: "sail",
        playerId: m.playerId,
        shipIds: ids,
        tile,
      });
  }
  private fund(m: AiTransportMission, player: Player): void {
    const { world, progression, supply } = this.expansion,
      key = `${player.id}:${m.sea}`,
      port = world.building(m.port);
    if (
      !port ||
      port.playerId !== player.id ||
      world.owners[port.tile] !== player.id ||
      port.remainingTicks ||
      (port.health ?? 1) <= 0
    )
      return;
    if (
      m.purchases >= 2 ||
      (this.spending.get(key) ?? 0) >= 2 ||
      (!this.spending.has(key) &&
        [...this.spending.keys()].filter((k) => k.startsWith(`${player.id}:`))
          .length >= 16)
    )
      return;
    if (
      [...this.economy.navalFacts.paidShips(player.id, m.sea)].some(
        (j) => j.category === "ship" && j.kind === "transport",
      )
    )
      return;
    const definition = VESSELS.slice()
      .reverse()
      .find(
        (v) =>
          v.kind === "transport" &&
          progression.has(player.id, v.technologyId) &&
          AGES.indexOf(v.age) <= AGES.indexOf(port.age ?? "StoneAge"),
      );
    if (!definition) return;
    const liquid = {
        gold: player.gold,
        reserves: player.reserves,
        items: supply.inventories[player.id],
      },
      free = this.economy.ledger.spendable(player.id, liquid, m.id);
    if (!affordableAiCost(free, definition.cost)) {
      m.reason = "Waiting for an affordable researched transport";
      return;
    }
    if (
      !this.economy.ledger.tryReserve(
        {
          id: m.id,
          claimant: m.id,
          playerId: player.id,
          generation: m.generation,
          priority: "growth",
          amounts: definition.cost,
          createdTick: world.tick,
          progressTick: world.tick,
          expiresTick: m.deadline,
        },
        liquid,
      )
    )
      return;
    const accepted = this.command(m, {
      type: "recruit-ship",
      playerId: player.id,
      buildingId: port.id,
      shipType: "transport",
      definitionId: definition.id,
    });
    this.economy.ledger.release(m.id);
    if (accepted) {
      m.purchases++;
      this.spending.set(key, (this.spending.get(key) ?? 0) + 1);
    }
  }
  step(budget = 16): number {
    const { world, operations } = this.expansion;
    this.diagnostics.work = 0;
    if (!budget || !world.players.length || !this.economy.navalFacts.ready)
      return 0;
    let player: Player | undefined;
    for (let n = 0; n < world.players.length; n++) {
      const p = world.players[this.cursor++ % world.players.length];
      if (
        this.missions.has(p.id) ||
        (this.economy.enabled(p) &&
          world.options?.aiNaval &&
          world.options.deferredPlanning)
      ) {
        player = p;
        break;
      }
    }
    if (!player) return 0;
    let m = this.missions.get(player.id);
    if (m && m.generation !== world.aiGeneration(player.id)) {
      this.release(player.id);
      return 0;
    }
    if (m && (m.phase === "complete" || m.phase === "abort")) {
      if (world.tick < m.nextThink) return 0;
      this.release(player.id);
      m = undefined;
    }
    if (!m) {
      if (
        !this.economy.enabled(player) ||
        !world.options?.aiNaval ||
        !world.options.deferredPlanning ||
        world.tick < personalityOf(player).raidAfterTicks
      )
        return 0;
      const target = operations.enabled(player)
        ? operations.offensiveTarget(player.id)
        : world.players.find(
            (p) =>
              p.kind === "regular" &&
              !p.eliminated &&
              p.id !== player!.id &&
              world.hostile(player!.id, p.id) &&
              !world.paths.connected(player!.base, p.base),
          )?.id;
      if (target === undefined) return 0;
      const fleet = this.economy.naval.missions.get(player.id),
        seas = fleet
          ? [fleet.sea]
          : this.economy.navalFacts.seas(player.id).slice(0, 8);
      const port = seas.flatMap((sea) =>
        [...this.economy.navalFacts.ports(player!.id, sea)].slice(0, 1),
      )[0];
      if (!port) return 0;
      const water = portWaterTiles(world.map, port.tile)
        .find((t) => world.waterPaths.walkable(t));
      if (water === undefined) return 0;
      m = {
        id: `transport:${player.id}:${++this.serial}`,
        playerId: player.id,
        generation: world.aiGeneration(player.id),
        sea: world.waterPaths.component[water],
        port: port.id,
        target,
        phase: "assess",
        since: world.tick,
        deadline: world.tick + 3600,
        nextThink: world.tick,
        cursor: 0,
        coastCursor: 0,
        roster: world
          .squadFacts()
          .byOwner(player.id)
          .map((s) => s.id),
        eligible: [],
        transports: [],
        escorts: [],
        groups: [],
        enemyPower: 0,
        reason: "Selecting capacity, cargo and a legal beachhead",
        purchases: 0,
        handedOff: false,
        initialTroops: 0,
        lostTroops: 0,
      };
      this.missions.set(player.id, m);
    }
    if (world.tick < m.nextThink) return 0;
    const target = world.players.find((p) => p.id === m!.target),
      port = world.building(m.port);
    const legal =
      !!target &&
      !target.eliminated &&
      world.hostile(player.id, target.id) &&
      !!port &&
      port.playerId === player.id &&
      world.owners[port.tile] === player.id &&
      (port.health ?? 1) > 0;
    if (
      m.phase !== "recover" &&
      m.phase !== "handoff" &&
      (!legal ||
        world.tick >= m.deadline ||
        !this.economy.enabled(player) ||
        !world.options?.aiNaval)
    ) {
      this.transition(
        m,
        "recover",
        "Target, port, controller or mission deadline changed",
      );
      m.coastCursor = 0;
    }
    const coast = world.coast.waterEdges(m.sea);
    if (m.phase === "assess") {
      while (this.diagnostics.work < budget) {
        this.diagnostics.work++;
        if (m.cursor < m.roster.length) {
          const squad = this.cargoCandidate(player.id, m.roster[m.cursor++], port);
          if (squad)
            m.eligible.push(squad.id);
          continue;
        }
        if (m.shipCursor !== null) {
          const read = this.economy.navalFacts.readSea(
            "ships",
            m.sea,
            m.shipCursor,
          );
          m.shipCursor = read.next;
          if (read.invalid) {
            this.transition(
              m,
              "abort",
              "Naval facts changed during cargo selection",
            );
            break;
          }
          const ship = read.value;
          if (
            ship &&
            "destination" in ship &&
            ship.playerId === player.id &&
            ship.health * 5 >= this.expansion.vessel(ship).health * 3 &&
            !ship.refit &&
            !ship.boarding &&
            !ship.shoreTransfer &&
            (!this.economy.assets.held(`ship:${ship.id}`) ||
              ["patrol", "operation"].includes(
                this.economy.assets.leases.get(`ship:${ship.id}`)!.priority,
              ))
          ) {
            if (
              ship.kind === "transport" &&
              !world.squadFacts().cargo(ship.id).length &&
              m.transports.length < 3
            )
              m.transports.push(ship.id);
            else if (
              navalReady(ship, this.expansion.vessel(ship)) &&
              m.escorts.length < 4
            )
              m.escorts.push(ship.id);
          }
          continue;
        }
        const edge = coast[m.coastCursor++];
        if (edge) {
          if (
            target &&
            world.paths.connected(edge.landTile, target.base) &&
            (!operations.enabled(player) ||
              operations.canEnter(
                player.id,
                world.owners[edge.landTile],
                edge.landTile,
              )) &&
            !this.expansion.fortifications.blocked(edge.landTile, player.id) &&
            (!m.landing ||
              world.map.euclideanDistSquared(edge.landTile, target.base) <
                world.map.euclideanDistSquared(m.landing.landTile, target.base))
          )
            m.landing = { ...edge };
          continue;
        }
        // Assessment yields across ticks. Revalidate the complete uncommitted
        // roster immediately before deriving capacity and acquiring ownership.
        m.eligible = m.eligible.filter(id => !!this.cargoCandidate(player.id, id, port));
        m.transports = m.transports.filter(id => {
          const ship = this.availableHull(m!, id);
          return !!ship && ship.kind === "transport" && !world.squadFacts().cargo(id).length;
        });
        m.escorts = m.escorts.filter(id => {
          const ship = this.availableHull(m!, id);
          return !!ship && navalReady(ship, this.expansion.vessel(ship));
        });
        const reserve = Math.max(
          2,
          Math.ceil(
            (m.eligible.length *
              AI_DOCTRINES[personalityOf(player).id].reservePercent) /
              100,
          ),
        );
        const count = Math.min(
          20,
          m.eligible.length - reserve,
          m.transports.reduce(
            (n, id) => n + this.expansion.vessel(world.ship(id)!).capacity,
            0,
          ),
        );
        // Do not buy a boat for a mission that has no legal cargo, landing,
        // or escort. Such purchases previously remained unused at the port.
        if (!m.landing || m.eligible.length-reserve<2 || !m.escorts.length) {
          this.transition(m,"abort","No supported legal cargo, escort or landing");break;
        }
        if (!m.transports.length) {
          this.fund(m, player);
          m.shipCursor = undefined;
          m.coastCursor = coast.length;
          m.nextThink = world.tick + 100;
          break;
        }
        if (!m.landing || count < 2 || !m.escorts.length) {
          this.transition(
            m,
            "abort",
            "No supported legal cargo, escort or landing",
          );
          break;
        }
        let at = 0;
        m.groups = m.transports
          .map((id) => ({
            shipId: id,
            members: m!.eligible.slice(
              at,
              (at = Math.min(
                count,
                at + this.expansion.vessel(world.ship(id)!).capacity,
              )),
            ),
            boarded: false,
            landed: false,
          }))
          .filter((g) => g.members.length);
        m.transports = m.groups.map((g) => g.shipId);
        m.initialTroops = m.groups
          .flatMap((g) => g.members)
          .reduce((n, id) => n + world.squad(id)!.troops, 0);
        const assets = [
          ...m.groups.flatMap((g) =>
            g.members.map((id) => `squad:${id}` as const),
          ),
          ...[...m.transports, ...m.escorts].map((id) => `ship:${id}` as const),
        ];
        if (
          !this.economy.assets.acquire(
            assets.map((asset) => ({
              asset,
              playerId: player!.id,
              generation: m!.generation,
              controller: m!.id,
              priority: "boarding" as const,
              createdTick: world.tick,
              expiresTick: m!.deadline + 1000,
            })),
          )
        ) {
          this.transition(m, "abort", "Cargo or escort ownership changed");
          break;
        }
        this.transition(m, "assemble", "Real capacity and escort reserved");
        break;
      }
      return this.diagnostics.work;
    }
    this.diagnostics.work = 1;
    const ships = m.transports
        .map((id) => this.ownShip(m!, id))
        .filter((s): s is Ship => !!s),
      escorts = m.escorts
        .map((id) => this.ownShip(m!, id))
        .filter((s): s is Ship => !!s);
    if (
      m.phase !== "recover" &&
      (ships.length !== m.transports.length ||
        escorts.length !== m.escorts.length ||
        [...ships, ...escorts].some(
          (s) => !this.economy.assets.owns(`ship:${s.id}`, m!.id),
        ))
    ) {
      this.transition(m, "recover", "Transport or escort lost or preempted");
      m.coastCursor = 0;
    }
    if (m.phase === "assemble" || m.phase === "board") {
      if (!port) {
        this.transition(m, "recover", "Departure port lost");
        return 1;
      }
      const berth = portWaterTiles(world.map, port.tile)
        .find(
          (t) =>
            world.waterPaths.walkable(t) &&
            world.waterPaths.component[t] === m!.sea,
        );
      if (berth === undefined) {
        this.transition(m, "recover", "Departure berth lost");
        return 1;
      }
      this.sail(m, escorts, berth);
      for (const group of m.groups) {
        const ship = this.ownShip(m, group.shipId);
        if (!ship) continue;
        const cargo = world.squadFacts().cargo(ship.id),
          ids = new Set(cargo.map((s) => s.id));
        group.boarded = group.members.every((id) => ids.has(id));
        if (
          cargo.some((s) => !group.members.includes(s.id)) ||
          cargo.length > this.expansion.vessel(ship).capacity
        ) {
          this.transition(
            m,
            "recover",
            "Actual cargo identity or capacity changed",
          );
          break;
        }
        if (!group.boarded && !ship.boarding && world.tick - m.since < 800)
          this.command(m, {
            type: "board",
            playerId: player.id,
            shipId: ship.id,
            squadIds: group.members.filter((id) => !ids.has(id)),
          });
      }
      if (m.groups.every((g) => g.boarded)) {
        this.transition(
          m,
          "sail",
          "Actual cargo boarded; escorts concentrating",
        );
      } else if (world.tick - m.since >= 800) {
        this.transition(m, "recover", "Boarding deadline reached");
        m.coastCursor = 0;
      }
    } else if (m.phase === "sail") {
      const anchor = ships[0];
      if (!anchor) {
        this.transition(m, "recover", "No surviving transport");
        return 1;
      }
      const hostile = [
        ...this.economy.navalFacts.nearbyShips(m.sea, anchor, 16 * FIXED),
      ]
        .filter((s) => world.hostile(player!.id, s.playerId))
        .reduce(
          (n, s) => n + navalPower(this.expansion.vessel(s), s.health),
          0,
        );
      const power = escorts
        .filter((s) => navalReady(s, this.expansion.vessel(s)))
        .reduce(
          (n, s) => n + navalPower(this.expansion.vessel(s), s.health),
          0,
        );
      m.enemyPower = hostile;
      if (!power || power * 10 < hostile * 13) {
        this.transition(
          m,
          "recover",
          "Escort cannot safely contest local naval power",
        );
        m.coastCursor = 0;
      } else if (!m.landing) {
        this.transition(m, "recover", "Landing lost");
        m.coastCursor = 0;
      } else {
        this.sail(m, escorts, world.tileOf(anchor));
        if (
          escorts.every(
            (s) =>
              world.map.euclideanDistSquared(
                world.tileOf(s),
                world.tileOf(anchor),
              ) <=
              8 ** 2,
          )
        ) {
          this.sail(m, ships, m.landing.waterTile);
          this.sail(m, escorts, m.landing.waterTile);
        }
        if (
          ships.every(
            (s) =>
              s.destination === null &&
              world.map.manhattanDist(world.tileOf(s), m!.landing!.landTile) ===
                1,
          )
        )
          this.transition(m, "land", "Escorted voyage reached the legal shore");
      }
    } else if (m.phase === "land") {
      for (const group of m.groups) {
        const ship = this.ownShip(m, group.shipId);
        if (!ship) continue;
        const members = group.members.map((id) => world.squad(id));
        group.landed = members.every(
          (s) =>
            s &&
            s.playerId === player!.id &&
            s.embarkedOn === null &&
            world.paths.connected(world.tileOf(s), m!.landing!.landTile),
        );
        if (!group.landed && world.squadFacts().cargo(ship.id).length)
          this.command(m, {
            type: "unload",
            playerId: player.id,
            shipId: ship.id,
            tile: m.landing!.landTile,
          });
      }
      if (m.groups.every((g) => g.landed))
        this.transition(m, "handoff", "Physical landing completed");
      else if (world.tick - m.since >= 600) {
        this.transition(m, "recover", "Landing footprint deadline reached");
        m.coastCursor = 0;
      }
    } else if (m.phase === "handoff") {
      if (!m.handedOff) {
        const ids = m.groups
          .flatMap((g) => g.members)
          .filter(
            (id) =>
              world.squad(id)?.playerId === player!.id &&
              world.squad(id)!.embarkedOn === null,
          );
        this.economy.assets.release(m.id);
        this.economy.military.armyPlanner.adoptBeachhead(
          player,
          ids,
          m.landing!.landTile,
          m.target,
        );
        const ordinary = ids.filter((id) => !this.expansion.armies.armyOf(id));
        if (
          ordinary.length &&
          ids.length &&
          target &&
          !target.eliminated &&
          world.hostile(player.id, target.id)
        )
          this.command(m, {
            type: "order",
            playerId: player.id,
            squadIds: ordinary,
            order: { type: "move", tile: target.base },
          });
        m.handedOff = true;
        this.diagnostics.handoffs++;
      }
      this.transition(
        m,
        "complete",
        "Cargo transferred once to the supported land objective",
      );
    } else if (m.phase === "recover") {
      while (this.diagnostics.work < budget && !m.recovery) {
        this.diagnostics.work++;
        const edge = coast[m.coastCursor++];
        if (!edge) break;
        if (
          world.owners[edge.landTile] === player.id &&
          !this.expansion.fortifications.blocked(edge.landTile, player.id)
        )
          m.recovery = { ...edge };
      }
      if (m.recovery && world.owners[m.recovery.landTile] !== player.id) {
        m.recovery = undefined;
        m.coastCursor = 0;
      }
      if (m.recovery) {
        this.sail(m, ships, m.recovery.waterTile);
        this.sail(m, escorts, m.recovery.waterTile);
        for (const ship of ships)
          if (
            ship.destination === null &&
            world.map.manhattanDist(world.tileOf(ship), m.recovery.landTile) ===
              1 &&
            world.squadFacts().cargo(ship.id).length
          )
            this.command(m, {
              type: "unload",
              playerId: player.id,
              shipId: ship.id,
              tile: m.recovery.landTile,
            });
        if (ships.every((s) => !world.squadFacts().cargo(s.id).length))
          this.transition(
            m,
            "abort",
            "Surviving cargo returned to a friendly shore",
          );
      }
      if (world.tick - m.since >= 1000)
        this.transition(
          m,
          "abort",
          "Recovery deadline reached; surviving hulls and cargo remain physical and visible",
        );
    }
    if (m.phase !== "complete" && m.phase !== "abort")
      m.nextThink = world.tick + 20;
    return this.diagnostics.work;
  }
}
