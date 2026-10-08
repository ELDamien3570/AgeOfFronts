import { describe, expect, it } from "vitest";
import { CameraPanViewModel } from "../../src/skirmish/client/CameraPanViewModel";
import { BrowserControlPreferences } from "../../src/skirmish/client/ControlPreferences";
import {
  CONSTRUCTION_SHORTCUTS,
  LAND_RECRUITMENT,
  NAVAL_RECRUITMENT,
  hotkeyAction,
} from "../../src/skirmish/client/Controls";

const event = (code: string, overrides = {}) => ({
  code,
  repeat: false,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...overrides,
});
function travel(fps: number, diagonal = false) {
  const pan = new CameraPanViewModel();
  pan.setEnabled(true);
  pan.keyDown(event("KeyW"));
  if (diagonal) pan.keyDown(event("KeyD"));
  pan.step(0);
  let x = 0,
    y = 0;
  for (let n = 1; n <= fps; n++) {
    const delta = pan.step((n * 1000) / fps);
    x += delta.x;
    y += delta.y;
  }
  return { pan, x, y };
}

describe("WASD camera controls", () => {
  it("remembers both enabled and disabled mode across new camera sessions", () => {
    const values = new Map<string, string>();
    const store = () => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    });
    const first = new CameraPanViewModel(new BrowserControlPreferences(store));
    expect(first.enabled).toBe(false);
    first.setEnabled(true);
    const second = new CameraPanViewModel(new BrowserControlPreferences(store));
    expect(second.enabled).toBe(true);
    expect(second.keyDown(event("KeyW"))).toBe(true);
    second.setEnabled(false);
    expect(
      new CameraPanViewModel(new BrowserControlPreferences(store)).enabled,
    ).toBe(false);
  });
  it("still changes mode when browser storage is unavailable", () => {
    const blocked = new BrowserControlPreferences(() => {
      throw new Error("Blocked storage");
    });
    const pan = new CameraPanViewModel(blocked);
    expect(pan.enabled).toBe(false);
    expect(() => pan.setEnabled(true)).not.toThrow();
    expect(pan.enabled).toBe(true);
  });
  it("requires Shift for every construction and recruitment shortcut while preserving other controls", () => {
    for (const { key } of [
      ...CONSTRUCTION_SHORTCUTS,
      ...LAND_RECRUITMENT,
      ...NAVAL_RECRUITMENT,
    ]) {
      expect(hotkeyAction(event(`Key${key}`), true)).toBeNull();
      expect(
        hotkeyAction(event(`Key${key}`, { shiftKey: true }), true),
      ).toEqual(hotkeyAction(event(`Key${key}`)));
    }
    expect(hotkeyAction(event("KeyA", { ctrlKey: true }), true)).toEqual({
      type: "select-all",
    });
    expect(hotkeyAction(event("Digit1", { shiftKey: true }), true)).toEqual({
      type: "group",
      digit: 1,
      mode: "add",
    });
    expect(hotkeyAction(event("KeyR"), true)).toEqual({ type: "replenish" });
  });
  it("keeps eased camera distance consistent at 30 and 144 FPS without faster diagonals", () => {
    const slow = travel(30),
      fast = travel(144),
      diagonal = travel(60, true);
    expect(slow.y).toBeCloseTo(fast.y, 6);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(slow.y, 6);
    expect(slow.y).toBeGreaterThan(500);
    expect(slow.y).toBeLessThan(600);
  });
  it("stops on modifiers, focus clearing, and mode disable without stuck motion", () => {
    const { pan } = travel(60);
    expect(pan.keyDown(event("KeyA", { ctrlKey: true }))).toBe(false);
    expect(pan.step(1100)).toEqual({ x: 0, y: 0 });
    pan.keyDown(event("KeyD"));
    pan.step(1120);
    pan.clear();
    expect(pan.step(1140)).toEqual({ x: 0, y: 0 });
    pan.setEnabled(false);
    expect(pan.keyDown(event("KeyW"))).toBe(false);
    expect(pan.step(1160)).toEqual({ x: 0, y: 0 });
  });
  it("caps stall displacement and eases to a stop after key release", () => {
    const { pan } = travel(60);
    expect(pan.step(11000).y).toBeLessThanOrEqual(30);
    pan.keyUp("KeyW");
    const first = pan.step(11020).y;
    const second = pan.step(11040).y;
    expect(first).toBeGreaterThan(second);
    expect(second).toBeGreaterThan(0);
  });
});
