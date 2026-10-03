import type { EncodedState } from "../StateCodec";
/** One exact executor-version baseline. Encoded strings are immutable; client
 * sequence/epoch envelopes remain per client and are never cached here. */
export class RecoveryBaselineCache {
  private entry?: {
    version: number;
    value: Promise<EncodedState>;
    bytes: number;
  };
  private closed = false;
  readonly diagnostics = { hits: 0, misses: 0 };
  get retainedBytes(): number {
    return this.entry?.bytes ?? 0;
  }
  get(
    version: number,
    capture: () => Promise<EncodedState>,
  ): Promise<EncodedState> {
    if (this.closed)
      return Promise.reject(new Error("Baseline cache is closed"));
    if (this.entry?.version === version) {
      this.diagnostics.hits++;
      return this.entry.value;
    }
    this.diagnostics.misses++;
    const entry = {
      version,
      value: undefined as unknown as Promise<EncodedState>,
      bytes: 0,
    };
    // Store before completion so concurrent consumers share the same capture.
    let captured: Promise<EncodedState>;
    try {
      captured = capture();
    } catch (error) {
      captured = Promise.reject(error);
    }
    entry.value = captured.then(
      (value) => {
        const frozen = Object.freeze({ ...value });
        if (this.entry === entry)
          entry.bytes = frozen.payload.length * 2 + frozen.hash.length * 2;
        return frozen;
      },
      (error) => {
        if (this.entry === entry) this.entry = undefined;
        throw error;
      },
    );
    this.entry = entry;
    return entry.value;
  }
  remember(version: number, value: EncodedState): void {
    if (this.closed) return;
    const frozen = Object.freeze({ ...value });
    this.entry = {
      version,
      value: Promise.resolve(frozen),
      bytes: frozen.payload.length * 2 + frozen.hash.length * 2,
    };
  }
  invalidate(): void {
    this.entry = undefined;
  }
  close(): void {
    this.closed = true;
    this.invalidate();
  }
}
