import { describe, expect, it } from "vitest";
import { resultText } from "../../src/skirmish/client/ResultText";

const players = [
  { id: 1, name: "Rome" },
  { id: 2, name: "Carthage" },
  { id: 3, name: "Gaul" },
];

describe("end-of-match result text", () => {
  it("celebrates a local victory", () => {
    expect(resultText(1, 1, players)).toEqual({
      title: "Victory",
      description: "Your empire has prevailed over every rival.",
    });
  });

  it("names the winner and does not claim the loser won", () => {
    const text = resultText(2, 1, players);
    expect(text.title).toBe("Carthage wins");
    expect(text.description).toBe("Carthage has prevailed. Your empire was not among the victors.");
    expect(text.description).not.toMatch(/enemy .* defeated/);
  });

  it("separates an allied victory the local player shares from one it does not", () => {
    expect(resultText(-1, 1, players, [1, 3])).toEqual({
      title: "Allied victory · Rome, Gaul",
      description: "Your alliance has prevailed over every rival.",
    });
    expect(resultText(-1, 2, players, [1, 3]).description).toBe(
      "Their alliance has prevailed. Your empire was not among the victors.",
    );
  });

  it("reports a draw and an unknown winner", () => {
    expect(resultText(0, 1, players).title).toBe("A hard-fought draw");
    expect(resultText(9, 1, players).title).toBe("An opponent wins");
  });
});
