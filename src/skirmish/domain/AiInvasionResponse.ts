import { MAX_ORDER_SQUADS } from "../FactionRules";
import { type Player, type Squad } from "../Protocol";
import { AI_DOCTRINES } from "../content/AiDoctrines";
import { personalityOf } from "../content/AiPersonalities";
import type { AiEconomicDirector } from "./AiEconomicDirector";
import type { Expansion } from "./Expansion";

interface Response {
  blocking?: boolean;
  id: string;
  generation: number;
  rival: number;
  tile: number;
  rally: number;
  cursor: number;
  roster: number[];
  members: number[];
  nextThink: number;
  until: number;
}
/** Emergency group orders work in every age. The existing lease owner prevents
 * economy, garrison and offensive planners from issuing competing orders. */
export class AiInvasionResponse {
  private readonly responses = new Map<number, Response>();
  readonly diagnostics = { work: 0, commands: 0 };
  constructor(
    private readonly expansion: Expansion,
    private readonly economy: AiEconomicDirector,
  ) {}
  checkpoint() {
    return structuredClone([...this.responses]);
  }
  restore(saved?: ReturnType<AiInvasionResponse["checkpoint"]>) {
    this.responses.clear();
    for (const [id, response] of structuredClone(saved ?? []))
      this.responses.set(id, response);
  }
  release(playerId: number) {
    const response = this.responses.get(playerId);
    if (response) this.economy.assets.release(response.id);
    this.responses.delete(playerId);
  }
  active(playerId: number) {
    return this.responses.has(playerId);
  }
  blocking(playerId:number) { return this.responses.get(playerId)?.blocking ?? false; }
  step(player: Player, budget: number, releaseOffense: () => void): number {
    const { world, operations, armies } = this.expansion;
    this.diagnostics.work = 0;
    const threat = operations
      .state(player.id)
      ?.threats.filter(
        (t) =>
          t.until >= world.tick &&
          world.hostile(player.id, t.rival) &&
          world.paths.connected(player.base, t.tile),
      )
      .sort(
        (a, b) =>
          world.map.euclideanDistSquared(player.base, a.tile) -
            world.map.euclideanDistSquared(player.base, b.tile) ||
          a.rival - b.rival,
      )[0];
    let response = this.responses.get(player.id);
    if (!threat) {
      this.release(player.id);
      return 0;
    }
    const localEnemies=world.squadFacts().aliveByOwner(threat.rival).filter(s=>s.embarkedOn===null &&
      world.map.euclideanDistSquared(world.tileOf(s),threat.tile)<=16**2);
    const pressure=localEnemies.reduce((n,s)=>n+s.troops,0);
    const ready=world.squadFacts().aliveByOwner(player.id).reduce((n,s)=>n+(s.embarkedOn===null && !s.refit ? s.troops : 0),0);
    const cities=world.buildingFacts().completed(player.id,"city").filter(b=>(b.health ?? 1)>0);
    const lastCityDanger=cities.length<=1 && cities.some(b=>world.map.euclideanDistSquared(b.tile,threat.tile)<=16**2);
    const blocking=lastCityDanger || pressure>Math.max(2000,ready/3);
    if (
      !response ||
      response.generation !== world.aiGeneration(player.id) ||
      response.rival !== threat.rival || response.blocking !== blocking
    ) {
      this.release(player.id);
      if(blocking)releaseOffense();
      response = {
        id: `invasion:${player.id}`,
        generation: world.aiGeneration(player.id),
        rival: threat.rival,
        tile: threat.tile,
        rally: player.base,
        cursor: 0,
        roster: [],
        members: [],
        nextThink: 0,
        until: threat.until,
        blocking,
      };
      this.responses.set(player.id, response);
    }
    response.tile = threat.tile;
    response.until = threat.until;
    if (world.tick < response.nextThink) return 0;
    if (!response.cursor) {
      response.roster = world
        .squadFacts()
        .byOwner(player.id)
        .map((s) => s.id);
      response.members = [];
      // Prefer the last city when there is only one; otherwise defend the city
      // closest to observed aggression. A connected owned rally stays legal.
      const cities = world
        .buildingFacts()
        .byType(player.id, "city")
        .filter((b) => !b.remainingTicks && (b.health ?? 1) > 0);
      const city = cities
        .slice()
        .sort(
          (a, b) =>
            world.map.euclideanDistSquared(a.tile, threat.tile) -
              world.map.euclideanDistSquared(b.tile, threat.tile) ||
            a.id - b.id,
        )[0];
      response.rally = city?.tile ?? player.base;
    }
    while (
      response.cursor < response.roster.length &&
      this.diagnostics.work < budget
    ) {
      const squad = world.squad(response.roster[response.cursor++]);
      this.diagnostics.work++;
      if (
        !squad ||
        squad.troops < 200 ||
        squad.embarkedOn !== null ||
        squad.refit ||
        squad.charge ||
        squad.order.type === "board"
      )
        continue;
      const lease = this.economy.assets.leases.get(`squad:${squad.id}`);
      if (
        lease &&
        lease.controller !== response.id &&
        !["patrol", "operation", "defense"].includes(lease.priority)
      )
        continue;
      if (!world.paths.connected(world.tileOf(squad), response.rally)) continue;
      const army = armies.armyOf(squad.id);
      if (army) continue;
      response.members.push(squad.id);
    }
    const complete = response.cursor >= response.roster.length;
    const members = response.members
      .map((id) => world.squad(id))
      .filter((s): s is Squad => !!s && s.troops > 0);
    members.sort(
      (a, b) =>
        world.map.euclideanDistSquared(world.tileOf(a), response!.rally) -
          world.map.euclideanDistSquared(world.tileOf(b), response!.rally) ||
        a.id - b.id,
    );
    const doctrine = AI_DOCTRINES[personalityOf(player).id];
    const lastCity =
      world
        .buildingFacts()
        .completed(player.id, "city")
        .filter((city) => (city.health ?? 1) > 0).length <= 1;
    const reserve = lastCity
      ? 0
      : Math.floor((members.length * doctrine.reservePercent) / 200);
    const required=blocking ? members.length-reserve : Math.min(members.length,Math.max(4,Math.ceil(pressure/1000)*2));
    const chosen = members.slice(0, Math.max(1, required));
    if (
      this.economy.assets.acquire(
        chosen.map((s) => ({
          asset: `squad:${s.id}` as const,
          playerId: player.id,
          generation: response!.generation,
          controller: response!.id,
          priority: "emergency-defense" as const,
          createdTick: world.tick,
          expiresTick: world.tick + 600,
        })),
      )
    ) {
      if (complete)
        this.economy.assets.retain(
          response.id,
          new Set(chosen.map((s) => `squad:${s.id}` as const)),
        );
      // Advance together once most reinforcements arrive. Units already in
      // contact keep fighting; retreating them to assemble would waste defense.
      const gathered = chosen.filter(
        (s) =>
          world.map.euclideanDistSquared(world.tileOf(s), response!.rally) <=
            12 ** 2 || s.fighting,
      ).length;
      const goal =
        gathered >= Math.ceil(chosen.length * 0.6)
          ? response.tile
          : response.rally;
      const idle = chosen.filter(
        (s) =>
          !s.fighting && (s.order.type !== "move" || s.order.tile !== goal),
      );
      for (let i = 0; i < idle.length; i += MAX_ORDER_SQUADS) {
        world.applyCommand({
          type: "order",
          playerId: player.id,
          squadIds: idle.slice(i, i + MAX_ORDER_SQUADS).map((s) => s.id),
          order: { type: "move", tile: goal },
        });
        this.diagnostics.commands++;
      }
    }
    if (complete) {
      response.cursor = 0;
      response.nextThink = world.tick + 10;
    }
    return this.diagnostics.work;
  }
}
