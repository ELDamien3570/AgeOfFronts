export interface ControlPreferenceStore {
  readWasdMode(): boolean;
  writeWasdMode(enabled: boolean): void;
}

const WASD_KEY = "skirmish.wasdMode";

// Browser storage is an adapter, not a dependency of camera movement.
export class BrowserControlPreferences implements ControlPreferenceStore {
  constructor(
    private readonly storage: () => Pick<Storage, "getItem" | "setItem">,
  ) {}

  readWasdMode(): boolean {
    try {
      return this.storage().getItem(WASD_KEY) === "true";
    } catch {
      return false;
    }
  }

  writeWasdMode(enabled: boolean): void {
    try {
      this.storage().setItem(WASD_KEY, String(enabled));
    } catch {
      // The preference still applies to this session if storage is blocked.
    }
  }
}
