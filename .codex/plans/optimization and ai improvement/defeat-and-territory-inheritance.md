# Defeat and territory inheritance

Status: reproduced rule conflict; recovery direction accepted by the user, source unchanged. September 30, 2026.

## Report and conclusion

The user observed a tribe killing a nation's starting troops and apparently receiving the whole nation. A controlled `ages-v1` reproduction confirms this can happen without capturing the starting camp or physically conquering the remaining territory.

The current rule treats absence of living military entities and buildings as terminal faction defeat. It then transfers all remaining owned land to the credited attacker in the same tick. A building-free opening therefore makes losing the starting army sufficient for losing the entire nation, even with owned land, reserves, gold, and the technology to rebuild.

This is a gameplay-rule conflict, not evidence that ordinary capture spreads incorrectly. It applies to attackers other than tribes too. Starting with no buildings is confirmed; requiring a token building to prevent instant collapse is not an adequate correction.

## Current source path

1. [Simulation.deployPlayer](../../../src/skirmish/Simulation.ts) creates three starting melee formations for a regular `ages-v1` faction and returns without constructing a building.
2. Combat resolves casualties and updates [ConquestCredit](../../../src/skirmish/Conquest.ts) from lethal damage contributions.
3. `Simulation.checkWinner` identifies players with no surviving military entries and no building entries. It does not require loss of owned land, capture of the original camp, or inability to rebuild.
4. The terminal batch marks those players eliminated, resolves a surviving beneficiary, and calls `changeOwner` on every remaining tile they own.
5. `Simulation.applyCommand` rejects subsequent commands from eliminated players, so surviving reserves/gold cannot fund recovery.

Constructing buildings count as buildings for the predicate. Merely beginning a city can avoid the collapse while leaving all other facts unchanged. That makes a construction queue entry a de facto sovereignty token rather than evaluating whether the faction still controls usable territory.

The inspected [Conquest tests](../../../tests/skirmish/Conquest.test.ts) explicitly expect remnants to go to a buildingless faction's final squad killer. The [age integration tests](../../../tests/skirmish/AgesIntegration.test.ts) also expect elimination/inheritance after removing starting troops. Passing those assertions does not validate the desired opening behaviour; they encode the rule that needs review.

## Controlled reproduction

Fixture: synthetic all-land 250 x 125 map, seed 42, one regular AI opponent, tribes enabled, AI planning disabled, `ages-v1`. Move three tribal infantry into melee range of the nation's three starting formations and reduce the defenders to one strength to exercise terminal resolution quickly. Combat/capture/elimination code remains unchanged. This is a targeted rule reproduction, not a natural battle-duration benchmark or a replay of the user's particular match.

| State | No building | City construction already started |
| --- | --- | --- |
| Nation's starting formations | 3 | 3 |
| Owned tiles before combat | 113 | 113 |
| Original camp owner before combat | Nation | Nation |
| Reserve bank | 9,000 | 9,000 |
| Gold before combat | 3,000 | 2,200 after paying for city |
| Formations after combat | 0 | 0 |
| Eliminated | Yes, on tick 1 | No, after three observed ticks |
| Remaining land | 0 | 113 |
| Old tiles automatically given to tribe | 113 | 0 |
| City build command after observation | Rejected: player cannot issue orders | Accepted |

A phase trace in the no-building case shows 113 owned tiles and the original camp still owned by the nation after ordinary capture. Immediately after elimination/inheritance, land is zero and the tribe owns the camp. This establishes that terminal inheritance, not physical occupation, produces the whole-nation transfer.

## Related AI vulnerability

The earlier opening-budget diagnostic found research consuming initial construction funds, with a barracks starting around 18 seconds and a city around 48 seconds in its separate fixture. That can lengthen exposure to this rule. Tribes also begin with five infantry and a completed barracks, while regular factions start with three infantry and no buildings.

Fixing AI budgets is necessary, but must not be used as the sovereignty fix. Humans can deliberately delay buildings, producers can be destroyed, and a faction may legitimately be between recruitment cycles. Slow early manpower and a smaller starting bank make the terminal-rule conflict more significant rather than solving it.

## Accepted recovery direction and remaining decisions

Separate a military setback from terminal elimination, and separate terminal elimination from territory disposition:

| Concept | Meaning |
| --- | --- |
| Military setback | No fielded army, or insufficient forces for an operation. Trigger recovery/recruitment/defence planning. |
| Recoverable faction | Controls usable territory or other explicitly defined recovery/control assets. Losing the army alone must not eliminate this faction. |
| Terminal defeat | The agreed rules establish loss of sovereign control/recovery. The exact rule is a game decision, not merely an empty entity array. |
| Territory disposition | Physical conquest, agreed surrender/annexation, or a defined collapse policy. An army wipe cannot silently stand in for conquering all remaining territory. |

The user accepted keeping a faction alive while it controls usable owned land from which it can rebuild, even without units/buildings. An army wipe is a recoverable military setback, not automatic whole-nation annexation. Do not require immediate affordability at the exact casualty tick if legitimate income and unlocked construction can recover it. Recruitment still needs real facilities, manpower, and equipment; survival does not spawn free replacement troops.

The precise usable-territory predicate, final political-defeat rule and remaining-land disposition still need agreement before implementation. Acceptance of recovery does not settle those details. Requiring occupation of every last remote tile may make cleanup tedious; if faster capitulation is desired, design an explicit control/surrender condition with visible counterplay. Capturing an arbitrary original camp or adding a short invulnerability timer is not a substitute for deciding sovereignty and recovery.

Do not patch this by granting a free city/barracks, exempting only tribes as attackers, checking only a startup timeout, ignoring kills during research, or hiding inheritance in the UI. Those approaches preserve the conflicting rule or violate the confirmed opening.

## DDD/MVVM ownership

Define a domain defeat/control policy using coherent ownership, military, building, and recovery read models. The authoritative tick resolves combat, occupation, recovery eligibility, terminal transitions, conquest attribution, and final victory in a documented deterministic order.

Read models expose meaningful state such as army lost, recovering, and eliminated. Views show it; they do not keep a faction alive through a visible row or fabricate recovery. AI responds to recoverable setbacks by constructing/recruiting on legal owned land, including a new suitable site when the original base is lost.

Use incremental ownership/producer/capability facts where possible. Evaluating recovery must not become another full-world search per faction every tick. Rejected recovery commands remain ordinary domain results, not proof that an entire faction is necessarily defeated.

## Tribe graduation dependency

Conquest-based [tribe graduation](tribe-development.md) must depend on the corrected terminal defeat event. The present army-wipe inheritance must not become a shortcut granting full-nation capabilities. Winning a battle against a building-free opening nation is not sufficient while that nation still has sovereign control under the new agreed rule.

Preserve canonical conquest attribution for genuine terminal outcomes, but do not equate a casualty-credit record with proof of nation defeat. Multiple attackers, simultaneous defeat, stable faction identity, no free technology, and updated victory eligibility still apply.

## Required regression scenarios

- Human and AI regular factions lose all three starting troops, own usable land, and have no buildings: survive and retain land under the accepted recovery direction.
- Repeat with no immediately affordable build but legal continuing income; define recovery viability explicitly rather than relying on current cash.
- Compare no building, construction in progress, completed city, completed barracks, and last producer destroyed: no accidental sovereignty distinction based only on whether an object exists.
- Original camp lost while other usable territory or legitimate forces remain; define relocation and recovery rather than automatic defeat.
- Genuine loss of sovereign control/recovery; verify the agreed territory disposition and victory outcome.
- Army wiped by tribe, nation, combined attackers, aircraft/naval effects, or any future approved plague: source of losses does not bypass the rule.
- Recovery construction/recruitment after an army wipe; reject only actual invalid commands, preserve reserve/equipment conservation, and update force counts correctly.
- Genuine qualifying tribe conquest versus recoverable army wipe: only the former graduates the tribe.
- Simultaneous terminal batches, beneficiary chains, reset/load, snapshots, and announcements remain consistent.

Update existing tests that enshrine the conflicting rule as part of the correction, rather than retaining them and adding a separate contradictory opening exception. No code or test files have been changed in this investigation.
