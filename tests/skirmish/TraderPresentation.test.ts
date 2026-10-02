import { afterEach, describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { EraArtwork } from "../../src/skirmish/client/EraArtwork";
import { traderSymbol } from "../../src/skirmish/client/MapSymbols";
import { TraderPresentation } from "../../src/skirmish/client/TraderPresentation";
import { AGES } from "../../src/skirmish/domain/Definitions";
import { FIXED, type Snapshot } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture() {
  const terrain = new Uint8Array(80 * 40).fill(133);
  const snapshot = new Skirmish(
    new GameMapImpl(80, 40, terrain, terrain.length),
    { seed: 42, aiCount: 1, runAi: false, tribes: false, ruleset: "ages-v1" },
  ).snapshot();
  snapshot.tick = 20;
  const trader: NonNullable<Snapshot["expansion"]>["traders"][number] = {
    id: 500,
    playerId: 1,
    factoryId: 100,
    definitionId: "bronzeage-trader",
    naval: false,
    x: 20 * FIXED,
    y: 20 * FIXED,
    cargo: 10,
    loaded: 10,
    delivered: 0,
    lost: 0,
    returned: 0,
    valuePerGood: 100,
    originTile: 0,
    capacity: 10,
    shipmentId: 1,
    stops: [],
    visited: [],
    destination: 101,
    state: "outbound",
    waitTicks: 0,
    quoteAllies: [],
  };
  snapshot.expansion!.traders = [trader];
  const presentation = new TraderPresentation();
  presentation.update(snapshot);
  return { snapshot, trader, presentation };
}

afterEach(() => vi.unstubAllGlobals());

describe("trader presentation", () => {
  it("faces actual travel, interpolates position, and keeps heading when stopped", () => {
    const { snapshot, trader, presentation } = fixture();
    expect(presentation.pose(trader.id, 20)?.clip).toBe("idle");
    trader.x += FIXED;
    snapshot.tick++;
    const before = JSON.stringify(snapshot);
    presentation.update(snapshot);
    expect(presentation.pose(trader.id, 21, 0.5)).toMatchObject({
      x: 20.5 * FIXED,
      y: 20 * FIXED,
      clip: "running",
      elapsedTicks: 0,
    });
    expect(presentation.pose(trader.id, 21)?.angle).toBeCloseTo(-Math.PI / 2);
    expect(JSON.stringify(snapshot)).toBe(before);
    // Outbound is still the shipment state while loading at a stop.
    snapshot.tick++;
    presentation.update(snapshot);
    expect(presentation.pose(trader.id, 22)?.clip).toBe("idle");
    expect(presentation.pose(trader.id, 22)?.angle).toBeCloseTo(-Math.PI / 2);
    trader.y -= FIXED;
    snapshot.tick++;
    presentation.update(snapshot);
    expect(presentation.pose(trader.id, 23)?.angle).toBeCloseTo(-Math.PI);
  });

  it("preserves travel animation on duplicate packets, turns on a prize route, and removes stale actors", () => {
    const { snapshot, trader, presentation } = fixture();
    trader.x += FIXED;
    snapshot.tick++;
    presentation.update(snapshot);
    presentation.update(snapshot);
    expect(presentation.pose(trader.id, 23)).toMatchObject({
      clip: "running",
      elapsedTicks: 2,
    });
    trader.state = "prize";
    trader.playerId = 2;
    trader.x -= FIXED;
    snapshot.tick++;
    presentation.update(snapshot);
    expect(presentation.pose(trader.id, 24)?.angle).toBeCloseTo(Math.PI / 2);
    expect(presentation.pose(trader.id, 24)?.elapsedTicks).toBe(3);
    snapshot.expansion!.traders = [];
    presentation.update(snapshot);
    expect(presentation.pose(trader.id, 24)).toBeUndefined();
    snapshot.expansion!.traders = [trader];
    presentation.update(snapshot);
    expect(presentation.pose(trader.id, 24)?.angle).toBe(0);
    presentation.reset();
    expect(presentation.pose(trader.id, 24)).toBeUndefined();
  });

  it("plays every land trader's authored travel frames and applies the trade ship's opposite source facing", () => {
    vi.stubGlobal(
      "Image",
      class {
        onload?: () => void;
        set src(_value: string) {
          this.onload?.();
        }
      },
    );
    const art = new EraArtwork();
    for (const age of AGES.slice(1)) {
      const id = `${age.toLowerCase()}-trader`;
      const frames = Array.from(
        { length: 10 },
        (_, i) => art.get(id, "running", (i * 20) / 12)!,
      );
      expect(new Set(frames.map((f) => `${f.x}:${f.y}`)).size).toBe(10);
      expect(art.get(id, "running", (20 * 10) / 12)).toMatchObject({
        x: 0,
        y: 0,
      });
      expect(art.facing(id)).toBe(0);
    }
    const { snapshot, trader, presentation } = fixture();
    trader.naval = true;
    trader.definitionId = "bronzeage-trade";
    trader.x += FIXED;
    snapshot.tick++;
    presentation.update(snapshot);
    expect(
      presentation.pose(trader.id, 21)!.angle + art.facing(trader.definitionId),
    ).toBeCloseTo(Math.PI / 2);
    expect(art.get(trader.definitionId, "running", 5)).toBeDefined();
  });

  it("retains the trader size budget and includes rotated art in viewport bounds", () => {
    for (const zoom of [1, 5, 12, 14, 20, 32, 48, 96]) {
      const symbol = traderSymbol(zoom, true);
      if (symbol.artwork) {
        expect(symbol.size).toBe(Math.min(44, zoom * 2));
        expect(symbol.viewRadius).toBeGreaterThan(symbol.size / 2);
      }
    }
    expect(traderSymbol(48, true).size).toBe(traderSymbol(32, true).size);
    expect(traderSymbol(48, false).artwork).toBe(false);

    // Naval trade vessels scale 1.75x compared to land traders (44 -> 77)
    const landMax = traderSymbol(96, true, false);
    const navalMax = traderSymbol(96, true, true);
    expect(landMax.size).toBe(44);
    expect(navalMax.size).toBe(77);
    expect(navalMax.size / landMax.size).toBe(1.75);
    expect(navalMax.viewRadius).toBeGreaterThan(landMax.viewRadius);
  });
});
