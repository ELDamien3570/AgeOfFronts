import { recruitmentBatch } from "./Controls";

// Space is a held modifier rather than a command. Clear on lost focus so a
// missed key-up never leaves subsequent clicks stuck in five-unit mode.
export class RecruitmentControlsViewModel {
  spaceHeld = false;
  keyDown(code: string): boolean {
    if (code !== "Space") return false;
    this.spaceHeld = true;
    return true;
  }
  keyUp(code: string): void {
    if (code === "Space") this.clear();
  }
  clear(): void {
    this.spaceHeld = false;
  }
  batch(shift: boolean, wasdMode: boolean): number {
    return recruitmentBatch(shift, wasdMode, this.spaceHeld);
  }
}
