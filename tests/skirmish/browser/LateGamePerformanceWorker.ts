import { snapshotTransfers } from "../../../src/skirmish/SnapshotCodec";

function fixture(text: string): any {
  const arrays = {
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Int16Array,
    Int32Array,
    Float32Array,
    Float64Array,
  };
  return JSON.parse(text, (_key, value) => {
    if (value?.$benchmark === "number") return Number(value.value);
    if (value?.$benchmark === "map") return new Map(value.entries);
    if (value?.$benchmark === "set") return new Set(value.entries);
    if (value?.$benchmark === "array") {
      const bytes = Uint8Array.from(atob(value.bytes), (c) => c.charCodeAt(0));
      const type = arrays[value.type as keyof typeof arrays];
      if (!type) throw Error("Unknown benchmark array");
      return new type(bytes.buffer);
    }
    return value;
  });
}

let game: any,
  encoder: any,
  measured = 0,
  warmup = 0,
  pace = false,
  timer: ReturnType<typeof setInterval> | undefined,
  started = 0,
  initialTick = 0;
let phases: Record<string, number> = {};
const rows: { simulation: number; encoding: number; total: number; phases: Record<string, number> }[] = [];
const stats = (values: number[]) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    p99: sorted[Math.ceil(sorted.length * 0.99) - 1],
    max: sorted[sorted.length - 1],
    over50: values.filter((v) => v > 50).length,
  };
};
async function receive(data: any) {
  try {
    if (data.type === "start") {
      const source = data.source ?? (data.combined
        ? `/out/performance-investigation-20261012/combined-${data.baseline ? "baseline" : "candidate"}/src/skirmish`
        : data.baseline
        ? "/out/performance-investigation-20261012/baseline/src/skirmish"
        : "/src/skirmish");
      const { generateMigration } = await import(
        /* @vite-ignore */ `${source}/MigrationMap.ts`
      );
      const { Skirmish } = await import(
        /* @vite-ignore */ `${source}/Simulation.ts`
      );
      const { SnapshotEncoder } = await import(
        /* @vite-ignore */ `${source}/SnapshotCodec.ts`
      );
      const saved = fixture(
        await (
          await fetch(
            data.fixture ?? "/out/performance-investigation-20261012/fresh-browser-fixture.json",
          )
        ).text(),
      );
      const loaded = generateMigration(saved.width, saved.options.seed);
      game = new Skirmish(loaded.map, saved.options);
      game.restore(saved);
      game.onPhase = (name: string, ms: number) => { phases[name] = ms; };
      initialTick = saved.tick;
      pace = !!data.pace;
      encoder = new SnapshotEncoder(false, { compactFormationSlots: !data.legacyDetails });
      const packet = encoder.encode(
        game.replicationSource(),
        game.tileChanges,
        game.replicationFacts(),
      );
      self.postMessage({ packet }, { transfer: snapshotTransfers(packet) });
      if (pace) timer = setInterval(() => { void receive({ type: "advance" }); }, 50);
      return;
    }
    if (pace && data.type !== "advance") return;
    if (!game || measured >= 600) return;
    phases = {};
    if (warmup === 40) started = performance.now();
    let at = performance.now();
    game.step();
    const simulation = performance.now() - at;
    at = performance.now();
    const packet = encoder.encode(
      game.replicationSource(),
      game.tileChanges,
      game.replicationFacts(),
    );
    const encoding = performance.now() - at;
    const measuring = warmup++ >= 40;
    if (measuring) {
      measured++;
      rows.push({ simulation, encoding, total: simulation + encoding, phases });
    }
    self.postMessage(
      {
        packet,
        measured: measuring,
        progress: measuring && measured % 100 === 0 ? measured : undefined,
      },
      { transfer: snapshotTransfers(packet) },
    );
    if (measured === 600) {
      clearInterval(timer);
      self.postMessage({
        result: {
          count: measured,
          ticks: [initialTick + 41, game.tick],
          squads: game.squads.length,
          simulation: stats(rows.map((r) => r.simulation)),
          encoding: stats(rows.map((r) => r.encoding)),
          total: stats(rows.map((r) => r.total)),
          phases: Object.fromEntries(Object.keys(rows[0].phases).map(name => [name, stats(rows.map(row => row.phases[name]))])),
          pace: { scheduled: pace, gameSeconds: measured / 20, realSeconds: (performance.now() - started) / 1000, rate: (measured / 20) / ((performance.now() - started) / 1000) },
        },
      });
    }
  } catch (error) {
    clearInterval(timer);
    self.postMessage({
      error: error instanceof Error ? error.stack : String(error),
    });
  }
}
self.onmessage = ({ data }) => { void receive(data); };
