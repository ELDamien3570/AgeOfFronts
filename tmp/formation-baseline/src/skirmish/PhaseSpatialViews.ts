import { FIXED, type Ship, type Squad } from "./Protocol";
import { SpatialGrid } from "./SpatialGrid";
import type { UnitQueries } from "./UnitIndex";

export type SpatialQueries<T extends { x: number; y: number }> = Readonly<
  Pick<SpatialGrid<T>, "query" | "mayContain" | "sample">
>;
export type SpatialPhase = "combat" | "trade" | "projectiles";
export interface PhaseSpatialFacts {
  readonly tick: number;
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
  ) {
    const view = <T extends Squad | Ship>(): View<T> => ({
      grid: new SpatialGrid<T>(
        width * FIXED,
        height * FIXED,
        4 * FIXED,
        (row) => row.playerId,
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
      return this.read(
        this.ground,
        groundRevision,
        this.world.squads,
        (s) => s.embarkedOn === null,
      );
    };
    const groundAlive = () => {
      check();
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
      return this.read(
        this.warshipsAlive,
        shipRevision,
        this.world.ships,
        (s) => s.kind === "warship" && s.health > 0,
      );
    };
    return {
      tick,
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
