import { CombatGeometry } from "./domain/CombatGeometry";
import { FIXED, type Ship, type Squad } from "./Protocol";
import { SpatialGrid } from "./SpatialGrid";
import type { UnitQueries } from "./UnitIndex";

export type SpatialQueries<T extends { x: number; y: number }> = Readonly<
  Pick<SpatialGrid<T>, "query" | "queryOverlaps" | "mayContain" | "sample">
>;
export type SpatialPhase = "combat" | "trade" | "projectiles";
export interface PhaseSpatialFacts {
  readonly tick: number;
  readonly groundRevision: number;
  readonly phase: SpatialPhase;
  readonly ground: SpatialQueries<Squad>;
  readonly groundAlive: SpatialQueries<Squad>;
  readonly ships: SpatialQueries<Ship>;
  readonly warshipsAlive: SpatialQueries<Ship>;
}
interface View<T extends { x: number; y: number }> {
  grid: SpatialGrid<T>;
  revision: number;
}

/** One domain owner for four distinct inclusion contracts. Views are borrowed
 * only during the synchronous phase. Identical geometry/membership revisions
 * can share a rebuild across phases; live records still expose current damage.
 * Source order and 4-tile buckets match the original battle/trade indexes. */
export class PhaseSpatialViews {
  private readonly ground: View<Squad>;
  private readonly groundAlive: View<Squad>;
  private readonly ships: View<Ship>;
  private readonly warshipsAlive: View<Ship>;
  private groundAliveRevision = -1;
  private allGroundAlive = false;
  private warshipsAliveRevision = -1;
  private allShipsAliveWarships = false;
  readonly diagnostics = { rebuilds: 0, rows: 0, hits: 0 };
  constructor(
    width: number,
    height: number,
    private readonly world: {
      squads: readonly Squad[];
      ships: readonly Ship[];
      tick: number;
      squadFacts(): UnitQueries<Squad>;
      shipFacts(): UnitQueries<Ship>;
    },
    private readonly geometry = new CombatGeometry(),
  ) {
    const view = <T extends Squad | Ship>(): View<T> => ({
      grid: new SpatialGrid<T>(
        width * FIXED,
        height * FIXED,
        4 * FIXED,
        (row) => row.playerId,
        (row)=>"troops" in row && row.formation ? this.geometry.envelope(row,this.world.tick).broadRadius : 0,
      ),
      revision: -1,
    });
    this.ground = view<Squad>();
    this.groundAlive = view<Squad>();
    this.ships = view<Ship>();
    this.warshipsAlive = view<Ship>();
  }
  private read<T extends Squad | Ship>(
    view: View<T>,
    revision: number,
    source: readonly T[],
    eligible: (row: T) => boolean,
  ): SpatialQueries<T> {
    if (view.revision !== revision) {
      const rows = source.filter(eligible);
      view.grid.rebuild(rows);
      view.revision = revision;
      this.diagnostics.rebuilds++;
      this.diagnostics.rows += source.length;
    } else this.diagnostics.hits++;
    return view.grid;
  }
  facts(phase: SpatialPhase): PhaseSpatialFacts {
    const tick = this.world.tick,
      groundRevision = this.world.squadFacts().spatialRevision,
      shipRevision = this.world.shipFacts().spatialRevision;
    const check = () => {
      if (
        this.world.tick !== tick ||
        this.world.squadFacts().spatialRevision !== groundRevision ||
        this.world.shipFacts().spatialRevision !== shipRevision
      )
        throw new Error("Spatial phase view expired before consumption");
    };
    const ground = () => {
      check();
      if (this.groundAliveRevision !== groundRevision) {
        this.allGroundAlive = this.world.squads.every(s => s.embarkedOn !== null || s.troops > 0);
        this.groundAliveRevision = groundRevision;
      }
      return this.read(
        this.ground,
        groundRevision,
        this.world.squads,
        (s) => s.embarkedOn === null,
      );
    };
    const groundAlive = () => {
      check();
      // Identical inclusion and source order permit borrowing the same grid.
      // Casualties advance the revision and restore the alive-only view.
      if (this.groundAliveRevision !== groundRevision) {
        this.allGroundAlive = this.world.squads.every(s => s.embarkedOn !== null || s.troops > 0);
        this.groundAliveRevision = groundRevision;
      }
      if (this.allGroundAlive) return ground();
      return this.read(
        this.groundAlive,
        groundRevision,
        this.world.squads,
        (s) => s.embarkedOn === null && s.troops > 0,
      );
    };
    const ships = () => {
      check();
      return this.read(this.ships, shipRevision, this.world.ships, () => true);
    };
    const warshipsAlive = () => {
      check();
      if (this.warshipsAliveRevision !== shipRevision) {
        this.allShipsAliveWarships = this.world.ships.every(s => s.kind === 'warship' && s.health > 0);
        this.warshipsAliveRevision = shipRevision;
      }
      // Preserve the filtered inclusion contract when a dead/non-warship row
      // exists; otherwise the canonical row order is identical to all ships.
      if (this.allShipsAliveWarships) return ships();
      return this.read(
        this.warshipsAlive,
        shipRevision,
        this.world.ships,
        (s) => s.kind === "warship" && s.health > 0,
      );
    };
    return {
      tick,
      groundRevision,
      phase,
      get ground() {
        return ground();
      },
      get groundAlive() {
        return groundAlive();
      },
      get ships() {
        return ships();
      },
      get warshipsAlive() {
        return warshipsAlive();
      },
    };
  }
}
