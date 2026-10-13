import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../../Art/Runtime/Russians/manifest.json";
import {
  ARTWORK_CATALOG,
  buildingArtworkId,
  buildingPreviewArtworkId,
  type ArtworkAsset,
} from "../../src/skirmish/client/ArtworkCatalog";
import { EraArtwork } from "../../src/skirmish/client/EraArtwork";

describe("Russian runtime artwork", () => {
  it("points every warship's authored bow along all four travel directions", () => {
    const art = new EraArtwork();
    const warships = Object.entries(manifest as Record<string, ArtworkAsset>)
      .filter(([id]) => id.endsWith("-warship"));
    for (const [id, asset] of warships) {
      // Fleet angles rotate an upward-facing marker onto the travel vector.
      // The authored bow may instead point down, especially in later ages.
      const bowY = asset.facing === "screen-up" ? -1 : 1;
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ]) {
        const fleetAngle = Math.atan2(dy, dx) + Math.PI / 2;
        const rotation = fleetAngle + art.facing(id, "screen-up");
        expect(-bowY * Math.sin(rotation), id).toBeCloseTo(dx);
        expect(bowY * Math.cos(rotation), id).toBeCloseTo(dy);
        // Embarked squads use the opposite pose convention with the same art.
        const squadRotation = Math.atan2(dy, dx) - Math.PI / 2 + art.facing(id);
        expect(-bowY * Math.sin(squadRotation), id).toBeCloseTo(dx);
        expect(bowY * Math.cos(squadRotation), id).toBeCloseTo(dy);
      }
    }
  });
  it("uses Russian building previews in every era and binds ready troop portraits", () => {
    for (const age of [
      "StoneAge",
      "BronzeAge",
      "ClassicalAge",
      "EarlyMedieval",
      "LateMedieval",
      "Napoleonic",
      "EarlyModern",
      "Modern",
    ] as const) {
      const id = buildingPreviewArtworkId("barracks", age)!;
      expect(
        (ARTWORK_CATALOG[id] as ArtworkAsset & { source: string }).source,
      ).toContain(`/Russians/Buildings/${age}/`);
    }
    const portraits = Object.entries(ARTWORK_CATALOG).filter(([id]) =>
      id.startsWith("unit-portrait-"),
    );
    expect(portraits).toHaveLength(42);
    for (const [, asset] of portraits)
      expect((asset as ArtworkAsset & { source: string }).source).toContain(
        "Russians/Units/",
      );
  });
  it("ships only bounded 128px frames and valid atlas references", () => {
    for (const asset of Object.values(manifest) as ArtworkAsset[]) {
      for (const file of [asset.file, asset.poster].filter(
        Boolean,
      ) as string[]) {
        const data = readFileSync(resolve("Art/Runtime/Russians", file));
        expect(data.readUInt32BE(16), file).toBe(128);
        expect(data.readUInt32BE(20), file).toBe(128);
      }
      for (const clip of Object.values(asset.clips ?? {})) {
        const data = readFileSync(resolve("Art/Runtime/Russians", clip.file));
        expect(data.readUInt32BE(16), clip.file).toBe(128 * clip.columns);
        expect(data.readUInt32BE(20), clip.file).toBe(
          128 * Math.ceil(clip.frames / clip.columns),
        );
        expect(clip.fps).toBeGreaterThan(0);
      }
    }
  });
  it("uses real Stone Age workshop and trader art and uses the correct distinct later-era art", () => {
    const source = ARTWORK_CATALOG as Record<
      string,
      ArtworkAsset & { source?: string }
    >;
    expect(
      source[buildingArtworkId("siege-workshop", "StoneAge")!].source,
    ).toContain("Russians/Buildings/StoneAge/");
    expect(source["stoneage-trader"].source).toContain(
      "Russians/Traders/StoneAge/",
    );
    expect(source["building-earlymodern-barracks"].source).toContain(
      "Buildings/EarlyModern/",
    );
    expect(source["modern-warship"].source).toContain("Ships/Modern/");
    expect(source["modern-fighter"].source).toContain("Aircraft/Modern/");
  });
  it("keeps the gun ground plate identical between idle and all firing directions", () => {
    const asset = ARTWORK_CATALOG["building-modern-gun-nest"];
    expect(asset.groundBounds).toBeDefined();
    for (const direction of ["n", "e", "s", "w"]) {
      const firing =
        ARTWORK_CATALOG[`building-modern-gun-nest-firing-${direction}`];
      expect(firing.clips?.firing.groundBounds).toEqual(asset.groundBounds);
      expect(
        existsSync(resolve("Art/Runtime/Russians", firing.clips!.firing.file)),
      ).toBe(true);
    }
  });
});
