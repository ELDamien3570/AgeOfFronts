# Diplomacy force inspection

Status: UI and knowledge-contract plan. September 30, 2026.

Confirmed: show exact own/allied unit counts and enemy estimates when inspecting factions. This extends the current faction-click diplomacy panel; it does not implement a new HUD or source change.

## Current integration points

[EmpireView](../../../src/skirmish/client/EmpireView.ts) opens the diplomacy panel for the inspected player and renders identity, age, relationship, land/gold, and legal treaty actions. [EmpireViewModel.faction](../../../src/skirmish/client/EmpireViewModel.ts) currently supplies player/progression facts. The worker sends snapshots through [SnapshotCodec](../../../src/skirmish/SnapshotCodec.ts).

Extend the ViewModel's faction inspection projection with a permitted force summary. Do not add repeated `snapshot.squads.filter`/`groupBy` work inside View HTML, click handlers, or renderer frames. The worker-owned [force index](faction-force-read-model.md) is shared with AI query infrastructure; a knowledge adapter produces each observer's disclosure.

The existing inspected-faction ID and panel coordinator remain the entry points. Resolve the current selected faction identity when actions are submitted; a clicked territory changing ownership must not silently redirect the treaty action or leave another faction's force rows behind.

## Panel content

Keep identity/culture/age, relationship/term, and eligible alliance actions readable. Add a Forces section with an exact/estimated badge and concise totals, followed by a scrollable type breakdown. Counts are informational and do not recruit, select, or command foreign units.

| Row/group | Display |
| --- | --- |
| Land forces | Living formation count and actual fielded troop strength, separated from reserves. |
| By land definition | Unit name/art, that unit's age, live formations, and actual strength; older-age units remain separate. |
| Military navy | Warships and transports by definition, using vessel counts rather than personnel. |
| Aircraft | Fighters/bombers by definition, with exact entity counts for permitted factions. |
| Vehicles/support | Tank formations, siege/artillery, anti-air, and mobile MIRV launchers under their actual definitions. These rows are facets of land forces, not additional units added to the land total. |
| Fixed defences | Optional separate Defence section for towers, walls, trenches, gun nests, fixed launchers, and missile defence. Do not mix them into soldier totals. |
| Civilians | Optional separate economy summary; traders and trade ships are excluded from military totals. |

Military counts are the required first scope. Defence/civilian detail and other economic disclosure are optional follow-ups. Current exact gold/land display is a separate existing policy; this plan does not silently change it.

Default to occupied/known definitions. Own/allied zero rows can be shown when a roster filter is useful. For an enemy, unseen types are unknown; do not reveal a complete zero-filled roster or suggest absence of a weapon merely because it has not been observed.

## Example labels

Illustrative own/allied rows:

| Type | Age | Formations | Troop strength |
| --- | --- | ---: | ---: |
| Bronze swordsmen | Bronze | 12 | 8,400 |
| Chariots | Bronze | 3 | 2,250 |
| Classical infantry | Classical | 4 | 3,100 |

These are mock values, not readings from the user's match. A faction being Classical does not turn its Bronze troops into Classical troops for the display.

An enemy row might say "Bronze swordsmen: 8 recently observed; total unknown" with Last observed and confidence. Where an authored estimate model supports a credible bounded range, show that range with an estimate marker. Do not invent a narrow upper bound from incomplete sightings or display an arbitrary noisy exact total.

Use "No known siege" rather than "0 siege" for uncertain enemy data. Previously exact allied totals can appear as "Last confirmed: 12 formations at 07:23" after the alliance ends; they are no longer a current exact count.

## Knowledge contract

The inspection DTO is observer-relative and includes target faction ID, observation/summary tick, revision, classification, occupied/known type rows, and uncertainty metadata. Classification is exact, estimated, stale, or unknown as appropriate. Exact and estimated fields must not coexist in a payload that exposes a forbidden exact backing value.

| Relationship | Force disclosure |
| --- | --- |
| Own faction | Exact live composition at the published committed revision. |
| Direct active ally | Exact aggregate composition. This is confirmed information sharing, not shared army control, resources, production queues, or automatic map vision. |
| Non-ally | Observer-based estimate or unknown; do not query the internal exact index for its hidden total. |
| Ally of an ally | Non-ally policy unless directly allied; treaties are non-transitive. |
| Expired/broken ally | Stop new exact disclosures immediately at treaty transition. Preserve dated legitimately known information as stale intelligence. |

AI uses the same strategic knowledge rules. It can inspect its own production and the confirmed exact allied composition, but enemy counter/recruitment decisions use observations and uncertainty. Debug views have explicit privileged access and are not player/AI inspection adapters.

## Observation design still to settle

Enemy estimates require defined observation sources, detection range/occlusion, contact identity/type resolution, memory decay, and a calibrated confidence/range model. None of those numerical rules has been approved. Camera position alone is not an adequate strategic observation rule: an AI has no equivalent camera, and UI activity should not alter authoritative knowledge.

The current snapshots expose every enemy entity and the battlefield renderer can present those units. If that full-world exposure stays, a player can reconstruct composition and the panel's estimate is only a presentation convention. For genuinely incomplete intelligence, explicitly approve a military observation/visibility policy and filter unit/summary data consistently at the publication boundary.

Do not silently introduce a full fog-of-war feature through an optimization task. Record and resolve that game rule before implementing hidden enemy data. If multiplayer later requires secrecy, filter on the authoritative server; a local worker/client separation is not a security boundary against inspection of the local simulation.

Attack notifications to allies can support the Guardian profile without granting global shared vision. Specify their allowed objective/location/threat details separately from aggregate count disclosure. An automatic allied distress report is a proposal; the force-count permission alone does not determine all map intelligence.

## Update and interaction behaviour

- Produce compact changed rows/removals from revisioned summaries. A full faction summary is valid on initial inspection/reset, not on every rendered frame.
- Exact refers to the stated snapshot tick, not a claim of zero-latency browser state. Proposed refresh ceiling is approximately once per simulated second for composition, with relationship transitions immediate at the next publication. Tune this against measured packet cost and perceived freshness.
- Keep alliance buttons and countdown independent of the slow count refresh. Expiry invalidates exact rows even if no unit count changed.
- Preserve inspected faction, focus, expanded groups, scroll position, and tactical selection while updating text. Do not rebuild the entire panel and steal focus for every casualty.
- A broken/expired treaty must remove current exact classification before any later stale summary update is shown.
- Handle eliminated factions, empty forces, unsupported/missing art, long culture/unit names, and rapid changes of selected faction without leaking previous rows.
- Opening inspection preserves orders and camera. Follow existing panel/input arbitration; it must not issue troop commands or automatically pause the match.

## MVVM and protocol responsibilities

| Owner | Responsibility |
| --- | --- |
| Force index | Exact committed composition and lifecycle deltas. |
| Knowledge policy/projection | Authorized own/allied exact access; enemy contact memory and estimates. |
| Application/worker boundary | Immutable DTOs, tick/revision, filtering, reset/removal, and transition publication. |
| EmpireViewModel | Select inspected summary, resolve definition labels/art, format counts/ranges/freshness, and expose legal diplomacy actions. |
| EmpireView | Render rows/badges, scrolling/focus/accessibility, and dispatch explicit inspection/treaty intents. |

Use existing content IDs and localization/formatting mechanisms. Do not duplicate definition tables or estimate formulas in View code. The disclosure result and readiness labels are separate from the exact authoritative force index.

## UI validation

Verify desktop/short/narrow layouts, many unit definitions, mixed ages, depleted formations, embarked troops, aircraft, civilians, no known enemy contacts, stale estimates, and direct versus indirect allies. Test keyboard focus during updates and relationship transitions while the panel remains open.

Inspect actual packet contents when checking disclosure. Correct-looking labels alone do not establish that exact enemy counts or hidden entities are absent from the published data under an approved visibility policy.
