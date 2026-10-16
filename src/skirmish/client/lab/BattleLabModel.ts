import { GameMapImpl } from "../../../core/game/GameMap";
import { FORMATION_MOVEMENT } from "../../content/FormationMovement";
import { meleeCavalry } from "../../domain/CavalryAssault";
import { validateRankLaunchSpacing } from "../../domain/CavalryMelee";
import type { UnitDefinition } from "../../domain/Definitions";
import {
  createFormation,
  formationDoctrine,
  TURN,
  type FormationShape,
} from "../../domain/FormationGeometry";
import { eligibleShape } from "../../domain/FormationProfiles";
import {
  createManpower,
  remainingHealth,
  type RecipeVariant,
} from "../../domain/Manpower";
import {
  FIXED,
  TICKS_PER_SECOND,
  type Command,
  type Squad,
} from "../../Protocol";
import { Skirmish } from "../../Simulation";

import {
  battleDefinition,
  type BattleTuning,
  type RecipeTunings,
} from "./BattleTuning";
export {
  BATTLE_BONUS_TAGS,
  battleDefinition,
  type BattleTuning,
  type RecipeTunings,
  type WeaponTuning,
} from "./BattleTuning";

export type BattleSide = 1 | 2;
export interface BattleEntry {
  side: BattleSide;
  definitionId: string;
  formations: number;
  soldiers: number;
  variant: RecipeVariant;
  shape: FormationShape;
  deployment?: { depth: number; lane: number };
  tuning?: BattleTuning;
}
export const BATTLE_LIMIT = 24;

export function validateBattleSetup(
  entries: readonly BattleEntry[],
  separation: number,
  recipeTunings: RecipeTunings = {},
  definitions: ReadonlyMap<string, UnitDefinition> = new Map(),
): void {
  if (!Number.isFinite(separation) || separation < 4 || separation > 32)
    throw Error("Starting separation must be 4–32 tiles");
  for (const [id, tuning] of Object.entries(recipeTunings))
    battleDefinition(id, tuning, definitions.get(id));
  for (const side of [1, 2] as const) {
    const count = entries
      .filter((e) => e.side === side)
      .reduce((n, e) => n + e.formations, 0);
    if (count > BATTLE_LIMIT)
      throw Error(`Each side supports up to ${BATTLE_LIMIT} formations`);
  }
  for (const entry of entries) {
    const unit = battleDefinition(
        entry.definitionId,
        recipeTunings[entry.definitionId] ?? entry.tuning,
        definitions.get(entry.definitionId),
      ),
      recipe = unit.formationRecipe;
    if (!recipe || ![1, 2].includes(entry.side))
      throw Error("Unknown land unit or side");
    if (
      entry.deployment &&
      (!Number.isFinite(entry.deployment.depth) ||
        entry.deployment.depth < 0 ||
        entry.deployment.depth > 24 ||
        !Number.isFinite(entry.deployment.lane) ||
        Math.abs(entry.deployment.lane) > 36)
    )
      throw Error("Deployment must stay within the arena");
    if (
      !Number.isInteger(entry.formations) ||
      entry.formations < 1 ||
      entry.formations > BATTLE_LIMIT
    )
      throw Error("Invalid formation count");
    const capacity =
      entry.variant === "enlarged" ? recipe.enlargedCapacity : recipe.capacity;
    if (
      !["base", "enlarged"].includes(entry.variant) ||
      !Number.isInteger(entry.soldiers) ||
      entry.soldiers < 1 ||
      entry.soldiers > capacity
    )
      throw Error("Soldier count exceeds this recipe’s capacity");
    if (
      !formationDoctrine(unit.id).shapes.includes(entry.shape) ||
      eligibleShape(entry.soldiers, formationDoctrine(unit.id), entry.shape) !==
        entry.shape
    )
      throw Error("Formation unavailable for this unit and count");
  }
}

/** Overrides live only in this offline arena, keyed by squad, never in UNIT.
 * Ordinary checkpoints cannot describe an edited catalogue, so explicitly
 * reject them instead of allowing an apparently valid, divergent restore.
 */
class BalanceSimulation extends Skirmish {
  rankLaunchSpacing = 0.25;
  cavalryRankLaunchSpacing(): number {
    return this.rankLaunchSpacing;
  }
  private readonly localDefinitions = new Map<number, UnitDefinition>();
  bindDefinition(id: number, unit: UnitDefinition): void {
    this.localDefinitions.set(id, unit);
  }
  unitDefinition(squad: Pick<Squad, "id">): UnitDefinition | undefined {
    return this.localDefinitions?.get(squad.id);
  }
  override checkpoint(): never {
    throw Error(
      "Balance arenas are rebuilt from their roster; gameplay checkpoints are unavailable",
    );
  }
  override restore(): never {
    throw Error("Balance arenas cannot restore gameplay checkpoints");
  }
}

/** Disposable arena using the normal aggregate, movement, combat and commands.
 * The tiny controller only issues legal attack orders; it has no combat rules.
 * Two human seats prevent the economy/strategic AI from recruiting or expanding.
 */
export class BattleLabModel {
  readonly game: BalanceSimulation;
  controlledSide: BattleSide | null = null;
  started = false;
  private readonly initial = new Map<
    BattleSide,
    { formations: number; troops: number }
  >();

  constructor(
    readonly entries: readonly BattleEntry[],
    separation = 16,
    recipeTunings: RecipeTunings = {},
    definitions: ReadonlyMap<string, UnitDefinition> = new Map(),
    readonly rankLaunchSpacing = 0.25,
    readonly cavalryMode: "assault" | "ranks" = "assault",
  ) {
    validateRankLaunchSpacing(rankLaunchSpacing);
    if (cavalryMode !== "assault" && cavalryMode !== "ranks")
      throw Error("Unknown cavalry attack pattern");
    validateBattleSetup(entries, separation, recipeTunings, definitions);
    const terrain = new Uint8Array(96 * 96).fill(133);
    this.game = new BalanceSimulation(
      new GameMapImpl(96, 96, terrain, terrain.length),
      {
        seed: 42,
        aiCount: 0,
        humanNames: ["Blue", "Red"],
        humanColors: [6, 1],
        tribes: false,
        runAi: false,
        ruleset: "ages-v1",
        ...FORMATION_MOVEMENT,
      },
    );
    this.game.rankLaunchSpacing = rankLaunchSpacing;
    const template = structuredClone(this.game.squads[0]);
    for (const squad of [...this.game.squads]) this.game.removeSquad(squad.id);
    for (const building of [...this.game.buildings])
      this.game.removeBuilding(building.id);
    for (const side of [1, 2] as const) {
      const army = entries.filter((e) => e.side === side),
        total = army.reduce((n, e) => n + e.formations, 0);
      const rows = Math.min(6, total),
        direction = side === 1 ? 1 : -1;
      const rear = army.some((entry) => entry.deployment)
        ? Math.max(...army.map((entry) => entry.deployment?.depth ?? 0)) + 7
        : 0;
      let index = 0;
      for (const entry of army) {
        const unit = battleDefinition(
          entry.definitionId,
          recipeTunings[entry.definitionId] ?? entry.tuning,
          definitions.get(entry.definitionId),
        );
        for (let i = 0; i < entry.formations; i++, index++) {
          const x =
              48 -
              direction *
                (separation / 2 +
                  (entry.deployment?.depth ?? rear) +
                  Math.floor((entry.deployment ? i : index) / 6) * 7),
            y =
              48 +
              (entry.deployment
                ? entry.deployment.lane + (i % 6) * 5
                : ((index % 6) - (rows - 1) / 2) * 9);
          if (x < 3 || x > 93 || y < 3 || y > 93)
            throw Error("Deployment falls outside the arena");
          const manpower = createManpower(unit, entry.variant);
          const id = this.game.allocateId();
          this.game.bindDefinition(id, unit);
          this.game.addSquad({
            ...structuredClone(template),
            id,
            playerId: side,
            definitionId: unit.id,
            kind: unit.line,
            troops: entry.soldiers,
            manpower,
            x: x * FIXED,
            y: y * FIXED,
            formation: {
              ...createFormation(unit.id),
              shape: entry.shape,
              shapeLock: true,
              layoutTroops: entry.soldiers,
              facing: side === 1 ? (TURN * 3) / 4 : TURN / 4,
            },
            order: { type: "hold" },
            path: [],
            queuedOrders: [],
            charge: null,
            combatTargetId: null,
          });
        }
      }
      this.initial.set(side, {
        formations: total,
        troops: army.reduce((n, e) => n + e.formations * e.soldiers, 0),
      });
    }
  }

  get ready(): boolean {
    return [1, 2].every((side) =>
      this.game.squads.some((s) => s.playerId === side),
    );
  }
  get finished(): boolean {
    return this.started && !this.ready;
  }
  start(): void {
    if (!this.ready) throw Error("Add at least one formation to each side");
    this.started = true;
    this.autoOrder();
  }
  step(): void {
    if (!this.started || this.finished) return;
    if (this.game.tick % TICKS_PER_SECOND === 0) this.autoOrder();
    this.game.step();
  }
  command(command: Command): string | null {
    return this.game.applyCommand(command);
  }
  attackNearest(side: BattleSide, ids?: readonly number[]): void {
    const targets = this.game.squads.filter((s) => s.playerId !== side);
    for (const squad of this.game.squads.filter(
      (s) => s.playerId === side && (!ids || ids.includes(s.id)),
    )) {
      const target = [...targets].sort(
        (a, b) => distance(squad, a) - distance(squad, b) || a.id - b.id,
      )[0];
      if (target)
        this.command({
          type: "order",
          playerId: side,
          squadIds: [squad.id],
          order: {
            type: "attack",
            targetId: target.id,
            ...(this.cavalryMode === "ranks" &&
            meleeCavalry(this.game.unitDefinition(squad)!)
              ? { cavalryMode: "ranks" as const }
              : {}),
          },
        });
    }
  }
  private autoOrder(): void {
    for (const side of [1, 2] as const) {
      if (side === this.controlledSide) continue;
      const idle = this.game.squads
        .filter(
          (s) =>
            s.playerId === side &&
            !s.charge &&
            !s.cavalryEngagement &&
            !(s.order.type === "attack" && this.game.squad(s.order.targetId)),
        )
        .map((s) => s.id);
      if (idle.length) this.attackNearest(side, idle);
    }
  }
  summary(
    side: BattleSide,
    squads: readonly Pick<Squad, "playerId" | "troops" | "manpower">[] = this
      .game.squads,
  ) {
    const live = squads.filter((s) => s.playerId === side),
      initial = this.initial.get(side)!;
    const troops = live.reduce((n, s) => n + s.troops, 0);
    return {
      formations: live.length,
      troops,
      losses: initial.troops - troops,
      hp: live.reduce((n, s) => n + remainingHealth(s) / 1000, 0),
      initialTroops: initial.troops,
    };
  }
}
function distance(a: Squad, b: Squad) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}
