import { AiArmyPlanner } from "./AiArmyPlanner";
import { UNIT } from "../content/Units";
import type { Player } from "../Protocol";
import type { AiEconomicDirector } from "./AiEconomicDirector";
import type { Expansion } from "./Expansion";
import { unitRefitCost } from "./Refitting";

/** Military development owns reservations and leases; normal refit/recruit
 * commands retain sole authority over costs, jobs, movement and completion.
 */
export class AiMilitaryDirector {
  constructor(
    private readonly expansion: Expansion,
    private readonly economy: AiEconomicDirector,
  ) {this.armyPlanner=new AiArmyPlanner(expansion,economy);}
  readonly armyPlanner:AiArmyPlanner;
  step(budget:number):number{return this.armyPlanner.step(budget);}
  checkpoint(){return this.armyPlanner.checkpoint();}
  restore(saved?:ReturnType<AiArmyPlanner["checkpoint"]>):void{this.armyPlanner.restore(saved);}
  release(playerId: number): void {
    this.armyPlanner.release(playerId);
    for (const [id] of this.expansion.modernization.leases) {
      const squad = this.expansion.world.squad(id);
      if (squad?.playerId === playerId && !squad.refit)
        this.expansion.modernization.leases.delete(id);
    }
  }
  decide(player: Player): boolean {
    const { world, modernization, progression, supply } = this.expansion,
      ledger = this.economy.ledger,
      assets = this.economy.assets,
      own = world.squadFacts().byOwner(player.id).filter(
        (s) =>
          s.playerId === player.id && s.troops > 0 && s.embarkedOn === null,
      ),
      ids = new Set(own.map((s) => `modernize:${player.id}:${s.id}`));
    for (const reservation of ledger.reservations.values())
      if (
        reservation.playerId === player.id &&
        reservation.claimant.startsWith("modernize:") &&
        (!ids.has(reservation.claimant) ||
          !modernization.leases.has(Number(reservation.claimant.split(":")[2])))
      ) {
        ledger.release(reservation.id);
        assets.release(reservation.claimant);
      }
    for (const lease of assets.leases.values())
      if (
        lease.playerId === player.id &&
        lease.controller.startsWith("modernize:") &&
        !modernization.leases.has(Number(lease.controller.split(":")[2]))
      )
        assets.release(lease.controller);
    const free = ledger.spendable(player.id, {
      gold: player.gold,
      reserves: player.reserves,
      items: supply.inventories[player.id],
    });
    modernization.reserve(
      { ...player, gold: free.gold ?? 0 },
      own.filter((s) => !assets.held(`squad:${s.id}`)),
      progression.states[player.id].completed,
      { ...free.items },
      world.tick,
    );
    for (const squad of own) {
      const lease = modernization.leases.get(squad.id);
      if (
        !lease ||
        squad.refit ||
        squad.fighting ||
        squad.order.type === "board"
      )
        continue;
      const controller = `modernize:${player.id}:${squad.id}`,
        target = UNIT.get(lease.targetId);
      if (!target) continue;
      const cost = unitRefitCost(target),
        generation = world.aiGeneration(player.id);
      if (
        !ledger.tryReserve(
          {
            id: controller,
            claimant: controller,
            playerId: player.id,
            generation,
            priority: "committed",
            amounts: cost,
            createdTick: lease.startedTick,
            progressTick: world.tick,
            expiresTick: lease.startedTick + 600,
          },
          {
            gold: player.gold,
            reserves: player.reserves,
            items: supply.inventories[player.id],
          },
        )
      )
        continue;
      if (
        !assets.acquire([
          {
            asset: `squad:${squad.id}`,
            playerId: player.id,
            generation,
            controller,
            priority: "modernization",
            createdTick: lease.startedTick,
            expiresTick: lease.startedTick + 600,
          },
        ])
      ) {
        ledger.release(controller);
        continue;
      }
      if (world.owners[world.tileOf(squad)] !== player.id) {
        const home =
          world.owners[player.base] === player.id
            ? player.base
            : world.ownedLandNearest(player.id, player.base, 1)[0];
        if (
          home === undefined ||
          !world.paths.connected(world.tileOf(squad), home)
        ) {
          ledger.release(controller);
          assets.release(controller);
          modernization.leases.delete(squad.id);
          continue;
        }
        if (squad.order.type === "move" && squad.order.tile === home) continue;
        const rejected = world.applyCommand({
          type: "order",
          playerId: player.id,
          squadIds: [squad.id],
          order: { type: "move", tile: home },
        });
        if (rejected) {
          ledger.release(controller);
          assets.release(controller);
          modernization.leases.delete(squad.id);
        }
        return !rejected;
      }
      if (squad.moved || squad.order.type !== "hold") {
        if (squad.order.type === "hold") continue;
        return (
          world.applyCommand({
            type: "order",
            playerId: player.id,
            squadIds: [squad.id],
            order: { type: "hold" },
          }) === null
        );
      }
      const rejected = world.applyCommand({
        type: "refit",
        playerId: player.id,
        squadIds: [squad.id],
        definitionId: target.id,
      });
      if (!rejected) ledger.release(controller);
      else {
        ledger.release(controller);
        assets.release(controller);
        modernization.leases.delete(squad.id);
      }
      return !rejected;
    }
    return false;
  }
}
