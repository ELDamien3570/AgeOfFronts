import type { Player } from "../Protocol";
import { personalityOf } from "../content/AiPersonalities";
import { FACTION } from "../content/Factions";

export class FactionViewModel {
  constructor(readonly player: Player) {}
  get identity() {
    return this.player.factionId
      ? FACTION.get(this.player.factionId)
      : undefined;
  }
  get originName(): string {
    return this.identity?.origin === "historical"
      ? "Historical"
      : this.identity?.origin === "middle-earth"
        ? "Middle-earth"
        : this.identity?.origin === "westeros"
          ? "Westeros & Essos"
          : "";
  }
  get personalityName(): string {
    return this.player.ai ? personalityOf(this.player).name : "";
  }
  get description(): string {
    if (!this.player.ai) return "Player-controlled faction.";
    const profile = personalityOf(this.player);
    if (this.player.kind === "tribe")
      return `Expands continuously around its homeland with up to ten infantry squads. Pursues nearby threats and replenishes below ${Math.round(profile.replenishBelow / 10)}% strength; never negotiates or researches.`;
    return profile.description;
  }
}
