import { describe, expect, it } from "vitest";
import { PseudoRandom } from "../../src/core/PseudoRandom";
import { Diplomacy } from "../../src/skirmish/domain/Diplomacy";
import type { Command, Player } from "../../src/skirmish/Protocol";

type Action = Extract<Command, { type: "alliance" }>["action"];
const ACTIONS: Action[] = ["offer", "offer-long-term", "accept", "reject", "renew", "break", "declare",
  "end-long-term", "offer-peace", "accept-peace", "reject-peace", "dont-embargo", "allow-embargo"];

// The hostility table must return exactly what the direct rule computes after
// every kind of diplomacy change: treaties, wars, raids, peace, start
// protection, expiries over time and checkpoint restores.
describe("memoized diplomacy hostility", () => {
  for (const rules of [undefined, "raids-v1"] as const) {
    it(`matches the direct rule after random diplomacy (${rules ?? "legacy"})`, () => {
      const random = new PseudoRandom(rules ? 7 : 11);
      const players = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, ai: i % 2 === 0, eliminated: false, kind: "regular" }) as unknown as Player);
      let diplomacy = new Diplomacy(undefined, rules);
      if (rules) diplomacy.protectStart([1, 2], 40);
      let tick = 0, hostilePairs = 0, peacefulPairs = 0;
      for (let step = 0; step < 1500; step++) {
        const a = players[random.nextInt(0, players.length)], b = players[random.nextInt(0, players.length)];
        switch (random.nextInt(0, 7)) {
          case 0: diplomacy.action(a, b, ACTIONS[random.nextInt(0, ACTIONS.length)], tick); break;
          case 1: diplomacy.establishWar(a.id, b.id, tick); break;
          case 2: diplomacy.recordTheft(a.id, b.id, tick); break;
          case 3: tick += random.nextInt(1, 300); diplomacy.step(tick, players); break;
          case 4: if (random.nextInt(0, 40) === 0) { a.eliminated = !a.eliminated; diplomacy.step(tick, players); } break;
          case 5: if (random.nextInt(0, 60) === 0) {
            const restored = new Diplomacy(undefined, rules);
            restored.restore(diplomacy.checkpoint());
            diplomacy = restored;
          } break;
          default: break;
        }
        for (let x = 0; x <= players.length; x++)
          for (let y = 0; y <= players.length; y++)
          {
            const value = diplomacy.hostile(x, y);
            if (value) hostilePairs++; else if (x !== y) peacefulPairs++;
            expect(value, `step ${step} pair ${x}:${y}`).toBe((diplomacy as any).computeHostile(x, y));
          }
      }
      // Both outcomes must actually occur, or the comparison proves nothing.
      expect(hostilePairs).toBeGreaterThan(1000);
      expect(peacefulPairs).toBeGreaterThan(1000);
    });
  }
});
