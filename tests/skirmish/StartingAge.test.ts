import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import {
  STARTING_TECHNOLOGIES,
  TECHNOLOGIES,
} from "../../src/skirmish/content/Technology";
import { AGES, type Age } from "../../src/skirmish/domain/Definitions";
import { startingProgression } from "../../src/skirmish/domain/Progression";
import {
  defaultLobbySettings,
  migrateLobbySettings,
  validateLobbySettings,
} from "../../src/skirmish/lobby/LobbyDirectory";
import { Skirmish } from "../../src/skirmish/Simulation";

function createMatch(startingAge?: Age) {
  const width = 64;
  const height = 64;
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = 133; // all land

  const match = new Skirmish(
    new GameMapImpl(width, height, data, data.length),
    {
      seed: 42,
      aiCount: 2,
      tribes: true,
      tribeCount: 1,
      runAi: false,
      ruleset: "ages-v1",
      startingAge,
    },
  );
  return { match };
}

describe("Starting Tech Age Selector", () => {
  it("defaults lobby settings to StoneAge and validates startingAge", () => {
    const settings = defaultLobbySettings("heightmap-test1");
    expect(settings.startingAge).toBe("StoneAge");
    expect(() => validateLobbySettings(settings)).not.toThrow();

    const withBronze = validateLobbySettings({
      ...settings,
      startingAge: "BronzeAge",
    });
    expect(withBronze.startingAge).toBe("BronzeAge");

    expect(() =>
      validateLobbySettings({
        ...settings,
        startingAge: "InvalidAge" as any,
      }),
    ).toThrow("Choose a supported starting age.");

    const migrated = migrateLobbySettings({
      ...settings,
      startingAge: undefined,
    });
    expect(migrated.startingAge).toBe("StoneAge");
  });

  it("unlocks only default starting tech in Stone Age", () => {
    const state = startingProgression("StoneAge");
    expect(state.age).toBe("StoneAge");
    expect(state.completed).toEqual(STARTING_TECHNOLOGIES);
  });

  it("unlocks all Stone Age technologies when starting in Bronze Age", () => {
    const state = startingProgression("BronzeAge");
    expect(state.age).toBe("BronzeAge");

    const stoneTechs = TECHNOLOGIES.filter((t) => t.age === "StoneAge");
    const bronzeTechs = TECHNOLOGIES.filter((t) => t.age === "BronzeAge");

    for (const tech of stoneTechs) {
      expect(state.completed).toContain(tech.id);
    }
    for (const tech of bronzeTechs) {
      expect(state.completed).not.toContain(tech.id);
    }
  });

  it("unlocks all Stone and Bronze technologies when starting in Classical Age", () => {
    const state = startingProgression("ClassicalAge");
    expect(state.age).toBe("ClassicalAge");

    const priorTechs = TECHNOLOGIES.filter(
      (t) => t.age === "StoneAge" || t.age === "BronzeAge",
    );
    const classicalTechs = TECHNOLOGIES.filter((t) => t.age === "ClassicalAge");

    for (const tech of priorTechs) {
      expect(state.completed).toContain(tech.id);
    }
    for (const tech of classicalTechs) {
      expect(state.completed).not.toContain(tech.id);
    }
  });

  it("unlocks all technologies sequentially through each age", () => {
    for (let i = 0; i < AGES.length; i++) {
      const age = AGES[i];
      const state = startingProgression(age);
      expect(state.age).toBe(age);

      for (const t of TECHNOLOGIES) {
        const tIndex = AGES.indexOf(t.age);
        if (tIndex < i) {
          expect(state.completed).toContain(t.id);
        } else {
          // Current or future age tech should NOT be unlocked (except default starting techs if StoneAge)
          if (age !== "StoneAge" || !STARTING_TECHNOLOGIES.includes(t.id)) {
            expect(state.completed).not.toContain(t.id);
          }
        }
      }
    }
  });

  it("deploys regular players into Bronze Age with Bronze swordsmen in simulation", () => {
    const { match } = createMatch("BronzeAge");
    const expansion = match.expansion!;
    expect(expansion).toBeDefined();

    const regulars = match.players.filter((p) => p.kind === "regular");
    const tribes = match.players.filter((p) => p.kind === "tribe");

    expect(regulars.length).toBeGreaterThan(0);
    expect(tribes.length).toBeGreaterThan(0);

    for (const player of regulars) {
      const prog = expansion.progression.states[player.id];
      expect(prog.age).toBe("BronzeAge");

      // All Stone Age technologies completed
      const stoneTechs = TECHNOLOGIES.filter((t) => t.age === "StoneAge");
      for (const tech of stoneTechs) {
        expect(prog.completed).toContain(tech.id);
      }

      // Starting squad should be Bronze swordsmen
      const playerSquads = match.squads.filter((s) => s.playerId === player.id);
      expect(playerSquads.length).toBe(3);
      for (const squad of playerSquads) {
        expect(squad.definitionId).toBe("bronzeage-infantry");
      }
    }

    // Minor tribes share the match starting age
    for (const tribe of tribes) {
      const prog = expansion.progression.states[tribe.id];
      expect(prog.age).toBe("BronzeAge");
    }
  });

  it("deploys regular players into Modern with Modern rifle infantry in simulation", () => {
    const { match } = createMatch("Modern");
    const expansion = match.expansion!;
    expect(expansion).toBeDefined();

    const regulars = match.players.filter((p) => p.kind === "regular");
    for (const player of regulars) {
      const prog = expansion.progression.states[player.id];
      expect(prog.age).toBe("Modern");

      // Prior ages completed
      for (const age of AGES) {
        if (age === "Modern") continue;
        const ageTechs = TECHNOLOGIES.filter((t) => t.age === age);
        for (const tech of ageTechs) {
          expect(prog.completed).toContain(tech.id);
        }
      }

      // Starting squad should be Modern rifle infantry
      const playerSquads = match.squads.filter((s) => s.playerId === player.id);
      expect(playerSquads.length).toBe(3);
      for (const squad of playerSquads) {
        expect(squad.definitionId).toBe("modern-infantry");
      }
    }
  });
});
