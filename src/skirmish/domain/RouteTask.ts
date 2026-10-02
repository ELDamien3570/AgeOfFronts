export interface ArmyRouteRequest {
  armyId: number;
  squadId: number;
  revision: number;
}
export type MatchRouteTask =
  | { kind: "army"; request: ArmyRouteRequest }
  | { kind: "ship-admission"; admissionId: number; shipId: number; playerId: number }
  | {
      kind: "admission";
      admissionId: number;
      squadId: number;
      playerId: number;
    }
  | {
      kind: "navigation";
      operation: "repair" | "pursuit" | "blocked" | "smooth";
      squadId: number;
      revision: number;
      playerId?: number;
      generation?: number;
      targetId?: number;
      targetTile?: number;
      firing?: FiringPositionState;
    }
  | {
      kind: "ai-move";
      generation?: number;
      playerId: number;
      squadIds: number[];
      tile: number;
    };
import type { FiringPositionState } from "../FiringPositions";
