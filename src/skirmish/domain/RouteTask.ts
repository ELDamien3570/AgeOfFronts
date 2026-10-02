export interface ArmyRouteRequest {
  armyId: number;
  squadId: number;
  revision: number;
}
export type MatchRouteTask =
  | { kind: "army"; request: ArmyRouteRequest }
  | {
      kind: "navigation";
      operation: "repair" | "pursuit" | "blocked" | "smooth";
      squadId: number;
      revision: number;
      targetId?: number;
    }
  | {
      kind: "ai-move";
      generation?: number;
      playerId: number;
      squadIds: number[];
      tile: number;
    };
