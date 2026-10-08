import { describe, expect, it } from "vitest";
import {
  hotkeyAction,
  recruitmentBatch,
} from "../../src/skirmish/client/Controls";
import { RecruitmentControlsViewModel } from "../../src/skirmish/client/RecruitmentControlsViewModel";
const key = (code: string, shiftKey = false) => ({
  code,
  shiftKey,
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
});
describe("held recruitment modifiers", () => {
  it("allows Space recruitment without Shift in WASD mode, preserving Shift building shortcuts", () => {
    for (const code of ["KeyQ", "KeyW", "KeyE", "KeyB"]) {
      expect(hotkeyAction(key(code), true)).toBeNull();
      expect(hotkeyAction(key(code), true, true)?.type).toMatch(/recruit/);
      expect(hotkeyAction(key(code, true), true)?.type).toMatch(/recruit/);
    }
    expect(hotkeyAction(key("KeyA"), true, true)).toBeNull();
    expect(hotkeyAction(key("KeyA", true), true, true)?.type).toBe("construct");
    expect(hotkeyAction(key("Space"))).toBeNull();
    expect(hotkeyAction(key("Space"), true)).toBeNull();
  });
  it("uses Space for WASD batches and Shift for normal-mode batches", () => {
    const controls = new RecruitmentControlsViewModel();
    expect(controls.batch(true, true)).toBe(1);
    expect(controls.keyDown("Space")).toBe(true);
    expect(controls.batch(false, true)).toBe(5);
    expect(controls.batch(false, false)).toBe(1);
    expect(controls.batch(true, false)).toBe(5);
    controls.keyUp("KeyQ");
    expect(controls.spaceHeld).toBe(true);
    controls.keyUp("Space");
    expect(controls.batch(false, true)).toBe(1);
    controls.keyDown("Space");
    controls.clear();
    expect(controls.spaceHeld).toBe(false);
    expect(recruitmentBatch(true, true, false)).toBe(1);
  });
});
