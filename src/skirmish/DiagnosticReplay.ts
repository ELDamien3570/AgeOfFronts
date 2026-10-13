import type { Skirmish } from "./Simulation";

export interface DiagnosticReplay {
  version: 1;
  mapId: "migration";
  playerId: number;
  checkpoint: ReturnType<Skirmish["checkpoint"]>;
}

/** Lossless JSON envelope for local diagnostic fixtures; never a network codec. */
export function readDiagnosticReplay(text: string): DiagnosticReplay {
  const arrays = { Uint8Array, Uint16Array, Uint32Array, Int16Array, Int32Array, Float32Array, Float64Array };
  const replay = JSON.parse(text, (_key, value) => {
    if (value?.$benchmark === "number") return Number(value.value);
    if (value?.$benchmark === "map") return new Map(value.entries);
    if (value?.$benchmark === "set") return new Set(value.entries);
    if (value?.$benchmark === "array") {
      const bytes = Uint8Array.from(atob(value.bytes), c => c.charCodeAt(0));
      const type = arrays[value.type as keyof typeof arrays];
      if (!type) throw new Error("Unsupported replay array");
      return new type(bytes.buffer);
    }
    return value;
  });
  if (replay.version !== 1 || replay.mapId !== "migration" || !Number.isSafeInteger(replay.playerId) ||
      !replay.checkpoint || replay.checkpoint.version !== 11 || !Number.isSafeInteger(replay.checkpoint.tick) ||
      replay.checkpoint.width !== replay.checkpoint.height || !replay.checkpoint.players?.some((p: { id: number; ai: boolean; eliminated: boolean }) => p.id === replay.playerId && !p.ai && !p.eliminated))
    throw new Error("Invalid playable diagnostic replay");
  return replay;
}
