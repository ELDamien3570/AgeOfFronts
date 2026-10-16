// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import english from "../../resources/lang/en.json";
import { defeatText, localDefeated, showDefeatDialog } from "../../src/skirmish/client/DefeatDialog";

describe("defeat dialog (13 R3 minimum)", () => {
  it("applies only while the match continues after the local empire falls", () => {
    const players = [{ id: 1, eliminated: true }, { id: 2, eliminated: false }] as never;
    expect(localDefeated({ winner: null, players }, 1)).toBe(true);
    expect(localDefeated({ winner: null, players }, 2)).toBe(false);
    expect(localDefeated({ winner: 2, players }, 1)).toBe(false);
  });

  it("shows translated text once, observes or leaves", () => {
    const leave = vi.fn();
    showDefeatDialog(leave);
    showDefeatDialog(leave);
    expect(document.querySelectorAll("#defeat")).toHaveLength(1);
    expect(document.getElementById("defeat-title")!.textContent).toBe(english.skirmish_defeat.title);
    const [observe, exit] = [...document.querySelectorAll<HTMLButtonElement>("#defeat button")];
    expect(observe.textContent).toBe(defeatText("observe"));
    exit.click();
    expect(leave).toHaveBeenCalledOnce();
    observe.click();
    expect(document.getElementById("defeat")!.hidden).toBe(true);
    for (const key of ["eyebrow", "title", "description", "observe", "leave"] as const)
      expect(english.skirmish_defeat[key]).toBeTruthy();
  });
});
