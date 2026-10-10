import type { MatchOptions, Snapshot } from "../Protocol";
import type { Renderer } from "./Renderer";

/** Local entry-point extension. Normal/online clients never register a profile. */
export interface LocalSkirmishPresentation {
  reset(): void;
  update(snapshot: Snapshot): void;
  beginFrame(now: number, speed: number, paused: boolean): void;
  endFrame(now: number, renderMs: number): void;
}
export interface LocalSkirmishProfile {
  matchOptions: Partial<MatchOptions>;
  formationDrawing?: boolean;
  install(renderer: Renderer): LocalSkirmishPresentation;
  initializeControls(): void;
}
let profile: LocalSkirmishProfile | undefined;
export function configureLocalSkirmishProfile(
  value: LocalSkirmishProfile,
): void {
  if (profile)
    throw new Error("A local skirmish profile is already configured");
  profile = value;
}
export function localSkirmishProfile(): LocalSkirmishProfile | undefined {
  return profile;
}
