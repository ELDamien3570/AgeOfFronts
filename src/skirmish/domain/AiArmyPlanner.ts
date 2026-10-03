import { AI_DOCTRINES } from "../content/AiDoctrines";
import { personalityOf } from "../content/AiPersonalities";
import { FIXED, type Player, type Squad } from "../Protocol";
import type { AiEconomicDirector } from "./AiEconomicDirector";
import type { Expansion } from "./Expansion";
interface ArmyObjective {
  id: string;
  playerId: number;
  generation: number;
  phase:
    | "select"
    | "rally"
    | "assemble"
    | "advance"
    | "engage"
    | "recover"
    | "complete";
  created: number;
  since: number;
  deadline: number;
  nextThink: number;
  cursor: number;
  rosterIds: number[];
  home?: number;
  members: number[];
  armyId?: number;
  target?: number;
  targetTile?: number;
  initialTroops: number;
  reason: string;
}
export class AiArmyPlanner {
  readonly objectives = new Map<number, ArmyObjective>();
  private cursor = 0;
  private serial = 0;
  readonly diagnostics = { work: 0, commands: 0, rejected: 0, completed: 0 };
  constructor(
    private readonly expansion: Expansion,
    private readonly economy: AiEconomicDirector,
  ) {}
  checkpoint() {
    return structuredClone({
      objectives: [...this.objectives],
      cursor: this.cursor,
      serial: this.serial,
    });
  }
  restore(saved?: ReturnType<AiArmyPlanner["checkpoint"]>): void {
    this.objectives.clear();
    this.cursor = saved?.cursor ?? 0;
    this.serial = saved?.serial ?? 0;
    for (const [id, plan] of structuredClone(saved?.objectives ?? []))
      this.objectives.set(id, plan);
  }
  release(playerId: number): void {
    const plan = this.objectives.get(playerId);
    if (plan) this.economy.assets.release(plan.id);
    this.objectives.delete(playerId);
  }
  adoptBeachhead(
    player: Player,
    ids: readonly number[],
    tile: number,
    target: number,
  ): boolean {
    const { world, armies } = this.expansion;
    if (!armies.capacity(player.id) || this.objectives.has(player.id))
      return false;
    const members = ids
      .map((id) => world.squad(id))
      .filter(
        (s): s is Squad =>
          !!s &&
          s.playerId === player.id &&
          s.embarkedOn === null &&
          !s.refit &&
          !armies.armyOf(s.id) &&
          !this.economy.assets.held(`squad:${s.id}`),
      )
      .slice(0, armies.capacity(player.id));
    if (!members.length) return false;
    const plan: ArmyObjective = {
      id: `land-army:${player.id}:${++this.serial}`,
      playerId: player.id,
      generation: world.aiGeneration(player.id),
      phase: "assemble",
      created: world.tick,
      since: world.tick,
      deadline: world.tick + 2400,
      nextThink: world.tick,
      cursor: 0,
      rosterIds: members.map((s) => s.id),
      members: members.map((s) => s.id),
      target,
      targetTile: world.players.find((p) => p.id === target)?.base,
      initialTroops: members.reduce((n, s) => n + s.troops, 0),
      reason: "Taking ownership of the landed beachhead",
      home: tile,
    };
    if (
      !this.economy.assets.acquire(
        plan.members.map((id) => ({
          asset: `squad:${id}` as const,
          playerId: player.id,
          generation: plan.generation,
          controller: plan.id,
          priority: "operation" as const,
          createdTick: world.tick,
          expiresTick: plan.deadline + 800,
        })),
      )
    )
      return false;
    if (
      world.applyCommand({
        type: "create-army",
        playerId: player.id,
        squadIds: plan.members,
      })
    ) {
      this.economy.assets.release(plan.id);
      return false;
    }
    plan.armyId = armies.armyOf(plan.members[0])!.id;
    this.objectives.set(player.id, plan);
    world.applyCommand({
      type: "army-auto",
      playerId: player.id,
      armyId: plan.armyId,
      enabled: false,
    });
    this.order(plan, { type: "regroup", tile });
    return true;
  }
  private eligible(squad: Squad, plan: ArmyObjective): boolean {
    const { world } = this.expansion;
    return (
      squad.playerId === plan.playerId &&
      squad.troops >=
        AI_DOCTRINES[
          personalityOf(world.players.find((p) => p.id === plan.playerId)!).id
        ].minimumHealth &&
      squad.embarkedOn === null &&
      !squad.refit &&
      !squad.charge &&
      !squad.structureTarget &&
      !squad.fighting &&
      squad.order.type === "hold" &&
      !this.expansion.armies.armyOf(squad.id) &&
      !this.economy.assets.held(`squad:${squad.id}`) &&
      world.paths.connected(
        world.tileOf(squad),
        world.players.find((p) => p.id === plan.playerId)!.base,
      )
    );
  }
  private order(
    plan: ArmyObjective,
    order: import("./Definitions").ArmyOrder,
  ): boolean {
    const rejected = this.expansion.world.applyCommand({
      type: "army-order",
      playerId: plan.playerId,
      armyId: plan.armyId!,
      order,
    });
    this.diagnostics.commands++;
    if (rejected) {
      this.diagnostics.rejected++;
      plan.reason = rejected;
      return false;
    }
    return true;
  }
  step(budget = 24): number {
    const { world, armies, operations } = this.expansion;
    this.diagnostics.work = 0;
    if (!world.options?.deferredPlanning || !world.players.length) return 0;
    let player: Player | undefined;
    for (let n = 0; n < world.players.length; n++) {
      const candidate = world.players[this.cursor++ % world.players.length];
      if (this.economy.enabled(candidate)) {
        player = candidate;
        break;
      }
    }
    if (!player) return 0;
    let plan = this.objectives.get(player.id);
    if (
      plan &&
      (plan.generation !== world.aiGeneration(player.id) ||
        !armies.capacity(player.id))
    ) {
      this.release(player.id);
      return 0;
    }
    const profile = personalityOf(player),
      doctrine = AI_DOCTRINES[profile.id];
    if (plan && plan.phase === "complete") {
      if (world.tick < plan.nextThink) return 0;
      this.release(player.id);
      plan = undefined;
    }
    if (!plan) {
      if (!armies.capacity(player.id) || world.tick < profile.raidAfterTicks)
        return 0;
      const target = operations.enabled(player)
        ? operations.offensiveTarget(player.id)
        : world.players
            .filter(
              (p) =>
                p.id !== player!.id &&
                !p.eliminated &&
                p.kind === "regular" &&
                world.hostile(player!.id, p.id) &&
                world.paths.connected(player!.base, p.base),
            )
            .sort(
              (a, b) =>
                world.map.euclideanDistSquared(player!.base, a.base) -
                  world.map.euclideanDistSquared(player!.base, b.base) ||
                a.id - b.id,
            )[0]?.id;
      const threat = operations.state(player.id)?.threats[0];
      if (target === undefined && !threat) return 0;
      plan = {
        id: `land-army:${player.id}:${++this.serial}`,
        playerId: player.id,
        generation: world.aiGeneration(player.id),
        phase: "select",
        created: world.tick,
        since: world.tick,
        deadline: world.tick + 3600,
        nextThink: world.tick,
        cursor: 0,
        rosterIds: world
          .squadFacts()
          .byOwner(player.id)
          .map((s) => s.id),
        members: [],
        target: target ?? threat?.rival,
        targetTile:
          target === undefined
            ? threat?.tile
            : world.players.find((p) => p.id === target)?.base,
        initialTroops: 0,
        reason: "Selecting a reachable supported roster",
      };
      this.objectives.set(player.id, plan);
    }
    if (world.tick < plan.nextThink) return 0;
    if (plan.phase === "select") {
      const own = plan.rosterIds;
      while (plan.cursor < own.length && this.diagnostics.work < budget) {
        const squad = world.squad(own[plan.cursor++]);
        this.diagnostics.work++;
        if (squad && this.eligible(squad, plan)) plan.members.push(squad.id);
      }
      if (plan.cursor < own.length) return this.diagnostics.work;
      const available = plan.members
        .map((id) => world.squad(id)!)
        .filter((s) => s && this.eligible(s, plan!));
      const reserve = Math.max(
          2,
          Math.ceil((available.length * doctrine.reservePercent) / 100),
        ),
        maximum = Math.min(
          armies.capacity(player.id),
          available.length - reserve,
        );
      if (
        maximum <
        Math.min(profile.minimumRaidSquads, armies.capacity(player.id))
      ) {
        plan.cursor = 0;
        plan.rosterIds = world
          .squadFacts()
          .byOwner(player.id)
          .map((s) => s.id);
        plan.members = [];
        plan.nextThink = world.tick + 200;
        plan.reason = "Retaining mobile reserve while filling role shortfalls";
        return this.diagnostics.work;
      }
      available.sort((a, b) => {
        const ar = doctrine.preferredRoles.indexOf(this.expansion.unit(a).role),
          br = doctrine.preferredRoles.indexOf(this.expansion.unit(b).role);
        return (ar < 0 ? 99 : ar) - (br < 0 ? 99 : br) || a.id - b.id;
      });
      plan.members = available.slice(0, maximum).map((s) => s.id);
      plan.initialTroops = plan.members.reduce(
        (n, id) => n + world.squad(id)!.troops,
        0,
      );
      if (
        !this.economy.assets.acquire(
          plan.members.map((id) => ({
            asset: `squad:${id}` as const,
            playerId: player!.id,
            generation: plan!.generation,
            controller: plan!.id,
            priority: "operation" as const,
            createdTick: world.tick,
            expiresTick: plan!.deadline,
          })),
        )
      ) {
        plan.nextThink = world.tick + 60;
        plan.cursor = 0;
        plan.members = [];
        return this.diagnostics.work;
      }
      const rejected = world.applyCommand({
        type: "create-army",
        playerId: player.id,
        squadIds: plan.members,
      });
      this.diagnostics.commands++;
      if (rejected) {
        this.economy.assets.release(plan.id);
        plan.reason = rejected;
        plan.nextThink = world.tick + 200;
        plan.cursor = 0;
        plan.members = [];
        this.diagnostics.rejected++;
        return this.diagnostics.work;
      }
      plan.armyId = armies.armyOf(plan.members[0])!.id;
      world.applyCommand({
        type: "army-auto",
        playerId: player.id,
        armyId: plan.armyId,
        enabled: false,
      });
      if (
        this.order(plan, { type: "regroup", tile: plan.home ?? player.base })
      ) {
        plan.phase = "rally";
        plan.since = world.tick;
        plan.reason = "Rallying through transactional Army admission";
      } else {
        world.applyCommand({
          type: "disband-army",
          playerId: player.id,
          armyId: plan.armyId,
        });
        this.economy.assets.release(plan.id);
        plan.phase = "complete";
        plan.nextThink = world.tick + 200;
      }
      return this.diagnostics.work;
    }
    const army = armies.armies.find((a) => a.id === plan!.armyId),
      members = plan.members
        .map((id) => world.squad(id))
        .filter(
          (s): s is Squad => !!s && s.playerId === player!.id && s.troops > 0,
        );
    if (
      !army ||
      members.some((s) => !this.economy.assets.owns(`squad:${s.id}`, plan!.id))
    ) {
      this.release(player.id);
      return this.diagnostics.work;
    }
    const target = world.players.find((p) => p.id === plan!.target),
      troops = members.reduce((n, s) => n + s.troops, 0);
    if (
      plan.phase !== "recover" &&
      (world.tick >= plan.deadline ||
        !target ||
        target.eliminated ||
        !world.hostile(player.id, target.id) ||
        troops < plan.initialTroops * 0.55)
    ) {
      if (
        this.order(plan, { type: "regroup", tile: plan.home ?? player.base })
      ) {
        plan.phase = "recover";
        plan.since = world.tick;
        plan.reason = "Returning survivors through the same movement owner";
      }
    }
    if (
      plan.phase === "rally" &&
      members.every(
        (s) =>
          world.map.euclideanDistSquared(
            world.tileOf(s),
            plan!.home ?? player!.base,
          ) <
          12 ** 2,
      )
    ) {
      plan.phase = "assemble";
      plan.since = world.tick;
    } else if (
      plan.phase === "assemble" &&
      world.tick - plan.since >= doctrine.assemblyTicks
    ) {
      if (
        plan.targetTile !== undefined &&
        (!operations.enabled(player) ||
          operations.canEnter(player.id, plan.target!, plan.targetTile)) &&
        this.order(plan, { type: "move", tile: plan.targetTile })
      ) {
        plan.phase = "advance";
        plan.since = world.tick;
        plan.reason = "Supported Army advancing on its committed region";
      }
    } else if (plan.phase === "advance" || plan.phase === "engage") {
      const enemy = world
        .nearbyArmyEnemies(army, 12 * FIXED, player.id)
        .sort((a, b) => a.id - b.id)
        .find(
          (s) =>
            !operations.enabled(player) ||
            operations.canTarget(player!.id, s.playerId),
        );
      if (
        enemy &&
        plan.phase !== "engage" &&
        this.order(plan, { type: doctrine.engagement, targetId: enemy.id })
      ) {
        plan.phase = "engage";
        plan.since = world.tick;
      } else if (
        world.tick - plan.since >= doctrine.commitmentTicks &&
        this.order(plan, { type: "regroup", tile: plan.home ?? player.base })
      ) {
        plan.phase = "recover";
        plan.since = world.tick;
      }
    } else if (
      plan.phase === "recover" &&
      (members.every(
        (s) =>
          world.map.euclideanDistSquared(
            world.tileOf(s),
            plan!.home ?? player!.base,
          ) <
          12 ** 2,
      ) ||
        world.tick - plan.since >= 800)
    ) {
      this.economy.assets.release(plan.id);
      world.applyCommand({
        type: "disband-army",
        playerId: player.id,
        armyId: army.id,
      });
      plan.phase = "complete";
      plan.nextThink = world.tick + 400;
      plan.reason = "Survivors returned and objective leases released";
      this.diagnostics.completed++;
    }
    if (plan.phase !== "complete") plan.nextThink = world.tick + 40;
    return this.diagnostics.work;
  }
}
