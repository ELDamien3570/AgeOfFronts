const PAN_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);
const SPEED = 600; // CSS pixels per second, independent of zoom and game speed.
const RESPONSE = 0.09;

export class CameraPanViewModel {
  enabled = false;
  private readonly held = new Set<string>();
  private lastTime?: number;
  private vx = 0;
  private vy = 0;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.clear();
  }

  keyDown(
    event: Pick<
      KeyboardEvent,
      "code" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey"
    >,
  ): boolean {
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      this.clear();
      return false;
    }
    if (!this.enabled || !PAN_KEYS.has(event.code)) return false;
    this.held.add(event.code);
    return true;
  }

  keyUp(code: string): void {
    this.held.delete(code);
  }

  clear(): void {
    this.held.clear();
    this.vx = this.vy = 0;
    this.lastTime = undefined;
  }

  step(now: number): { x: number; y: number } {
    const dt =
      this.lastTime === undefined
        ? 0
        : Math.max(0, Math.min(0.05, (now - this.lastTime) / 1000));
    this.lastTime = now;
    const x = Number(this.held.has("KeyA")) - Number(this.held.has("KeyD"));
    const y = Number(this.held.has("KeyW")) - Number(this.held.has("KeyS"));
    const length = Math.hypot(x, y) || 1;
    const tx = (x / length) * SPEED,
      ty = (y / length) * SPEED;
    const decay = Math.exp(-dt / RESPONSE);
    // Integrate the eased velocity, keeping distance consistent across FPS.
    const delta = {
      x: tx * dt + (this.vx - tx) * RESPONSE * (1 - decay),
      y: ty * dt + (this.vy - ty) * RESPONSE * (1 - decay),
    };
    this.vx = tx + (this.vx - tx) * decay;
    this.vy = ty + (this.vy - ty) * decay;
    return delta;
  }
}
