import { describe, expect, it, vi } from "vitest";
import footLayout from "../../Art/Cultures/Russians/Units/StoneAge/Clubman/Formation/formation.json";
import type { ArcherVolley, Snapshot } from "../../src/skirmish/Protocol";
import { FormationHeading } from "../../src/skirmish/client/FormationHeading";
import { SoldierDrawQueue } from "../../src/skirmish/client/SoldierDrawQueue";
import { SoldierSelectionIndex } from "../../src/skirmish/client/SoldierSelectionIndex";
import { StoneAgeDemoActors } from "./browser/StoneAgeDemoActors";
import type { FormationLayout } from "./browser/TroopPrototypeModel";

describe("soldier detail mode", () => {
  it("previews individual destinations in the chosen shape with current strength and fixed soldier size", () => {
    const foot = {
      name: "Clubman",
      age: "StoneAge",
      mounted: false,
      ranged: false,
      memberScale: 0.24,
    };
    const cav = { ...foot, name: "Scout", mounted: true, memberScale: 0.6 };
    let shape: "line" | "square" = "line";
    const actors = new StoneAgeDemoActors(() => 0, {
      troops: [foot, cav],
      byDefinitionId: new Map([
        ["foot", foot],
        ["cav", cav],
      ]),
      formationForSquad: () => shape,
    });
    const internals = actors as unknown as {
      layouts: Map<string, FormationLayout>;
    };
    internals.layouts.set("Clubman", footLayout);
    internals.layouts.set("Scout", footLayout);
    const squad = {
      id: 1,
      definitionId: "foot",
      troops: 1000,
    } as Snapshot["squads"][number];
    const line = actors.deploymentPreview(squad, { x: 2560, y: 5120 }, 0)!;
    expect(line).toHaveLength(12);
    expect(
      actors.deploymentPreview(
        { ...squad, definitionId: "cav" },
        { x: 2560, y: 5120 },
        0,
      ),
    ).toHaveLength(6);
    expect(
      actors.deploymentPreview(
        { ...squad, troops: 500 },
        { x: 2560, y: 5120 },
        0,
      ),
    ).toHaveLength(6);
    const turned = actors.deploymentPreview(
      squad,
      { x: 2560, y: 5120 },
      Math.PI,
    )!;
    line.forEach((point, i) => {
      expect(turned[i].x).toBeCloseTo(20 - point.x);
      expect(turned[i].y).toBeCloseTo(40 - point.y);
    });
    shape = "square";
    const square = actors.deploymentPreview(squad, { x: 2560, y: 5120 }, 0)!;
    expect(square.map((p) => p.radius)).toEqual(line.map((p) => p.radius));
    expect(square.map((p) => [p.x, p.y])).not.toEqual(
      line.map((p) => [p.x, p.y]),
    );
    expect(actors.drawnSoldiers).toBe(0);
  });
  it("suspends pose processing and clears detailed picking on zoom-out", () => {
    const actors = new StoneAgeDemoActors(() => 0);
    const internals = actors as unknown as {
      headings: FormationHeading;
      selectionIndex: SoldierSelectionIndex;
    };
    const update = vi.spyOn(internals.headings, "update");
    internals.selectionIndex.beginFrame();
    internals.selectionIndex.add(1, 5, 5, 0.3);
    internals.selectionIndex.commit();
    const squad = { id: 1, afloat: null } as Snapshot["squads"][number];
    expect(actors.hitTest(squad, { x: 5, y: 5 }, 12)).toBe(0);
    expect(actors.setDetailed(false)).toBe(true);
    expect(actors.setDetailed(false)).toBe(false);
    actors.prune({ localPlayerId: 1 } as Snapshot);
    expect(update).not.toHaveBeenCalled();
    expect(actors.hitTest(squad, { x: 5, y: 5 }, 12)).toBeUndefined();
    const ctx = {} as CanvasRenderingContext2D;
    expect(
      actors.draw(ctx, squad, { x: 0, y: 0 }, 0, 10, 0, { x: 0, y: 0 }),
    ).toBe(false);
    expect(
      actors.drawVolley(
        ctx,
        {} as ArcherVolley,
        0,
        10,
        (p) => ({ x: p, y: p }),
        100,
        100,
      ),
    ).toBe(false);
    actors.drawRemains(ctx, 10, (p) => ({ x: p, y: p }), 100, 100);
    actors.setDetailed(true);
    expect(actors.hitTest(squad, { x: 5, y: 5 }, 12)).toBeUndefined();
  });
  it("draws selected rings underneath every sprite and none for unselected members", () => {
    const actors = new StoneAgeDemoActors(() => 0);
    const internals = actors as unknown as { drawQueue: SoldierDrawQueue };
    const events: string[] = [];
    const ctx = {
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      beginPath() {},
      arc: vi.fn(),
      fill() {},
      stroke() {
        events.push("ring");
      },
      drawImage() {
        events.push("sprite");
      },
    } as unknown as CanvasRenderingContext2D;
    actors.beginFrame();
    const frame = { x: 0, y: 0, width: 16, height: 16, pivot: { x: 8, y: 8 } };
    for (let id = 0; id < 3; id++)
      internals.drawQueue.add(
        1,
        id,
        id * 10,
        10,
        0,
        16,
        {} as CanvasImageSource,
        frame,
        id < 2 ? 4 : 0,
        "#cc6633",
      );
    actors.flush(ctx);
    expect(events).toEqual(["ring", "ring", "sprite", "sprite", "sprite"]);
    expect(actors.drawnSoldiers).toBe(3);
    actors.setDetailed(false);
    actors.beginFrame();
    actors.flush(ctx);
    expect(actors.drawnSoldiers).toBe(0);
  });
});
