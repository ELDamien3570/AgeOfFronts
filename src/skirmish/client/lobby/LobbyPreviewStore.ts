import type { EmpireProfile } from "../../lobby/EmpireProfile";
import type { CustomLobby } from "../../lobby/LobbyDirectory";

export interface LobbyPreviewData {
  version: 1;
  profile: EmpireProfile;
  visible: readonly CustomLobby[];
  queue: readonly CustomLobby[];
}

export interface LobbyPreviewStore {
  read(): unknown;
  write(data: LobbyPreviewData): boolean;
}

/** Own key; never reads or overwrites OpenFront auth/account/cosmetic settings. */
export class BrowserLobbyPreviewStore implements LobbyPreviewStore {
  private readonly key = "ageoffronts.lobby-preview.v1";

  read(): unknown {
    try {
      const stored = localStorage.getItem(this.key);
      return stored ? JSON.parse(stored) : undefined;
    } catch {
      return undefined;
    }
  }

  write(data: LobbyPreviewData): boolean {
    try {
      localStorage.setItem(this.key, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }
}
