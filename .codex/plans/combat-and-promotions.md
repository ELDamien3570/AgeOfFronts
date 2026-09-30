# Combat stats, promotions, and triggered charges

Design notes, September 30, 2026. These rules extend [the base tree](base-tech-tree.md), [unit refits](pacing-and-opening.md), [fortifications](fortifications-and-siege.md), and [the selected-unit UI](ui-materials-and-technology.md). This pass changes plans only.

## Confirmed direction

- Troops have Melee Armour, Ranged Armour, Melee Attack, Ranged Attack, Range, and Reload Time. Use the player-facing label Ranged Armour for the requested Ranger Armor stat.
- Squad capacity grows with the actual unit tier, and additional HP is the primary benefit of larger squads. Older troops stay smaller until explicitly refitted; higher capacity never supplies free reserve soldiers.
- Armour reduces incoming damage to lengthen combat; reload is a separate stat. Pre-Modern gunpowder is fairly inaccurate, and Early Modern firearms also reload slowly.
- Charge-capable definitions also have Charge Speed, Charge Damage, and Charge Reload Time.
- Promotions use the existing seven-level star icons. Experience is earned through combat damage, kills, and objectives.
- A fully promoted formation should be slightly less effective than a recruit from the corresponding next-age branch.
- Successfully upgrading/refitting a formation resets it to recruit promotion level; research alone changes neither its definition nor promotion.
- Double right-click an enemy or area to request a charge for eligible troops. Charges accelerate along a valid path, deal small area damage on impact, and partially penetrate armour.
- Siege weapons and bombs use separate Projectile Size for the projectile/hitbox and Blast Radius for area damage.

Numerical armour curves, XP thresholds, stat values, charge radius/run-up/cooldowns, exact eligible roster, objective scoring and naval/air promotion scope are content proposals below. Do not treat the illustrative promotion power budget or charge parameters as approved balance.

## Squad durability and gunpowder accuracy

The [army and squad-size plan](<optimization and ai improvement/armies-formations-and-squad-sizes.md>) connects tier-based capacities to recruitment, replenishment, refit, army membership and UI. Display current versus maximum strength/HP for the actual definition. Author attack quality independently: the recommended normalization uses remaining strength divided by that definition's capacity, with full-squad damage separately tuned. That formula remains a proposal; do not automatically multiply both HP and full attack power by the larger headcount.

Author accuracy/spread independently of damage, range, reload, projectile collision size and blast radius. Gunpowder misses must affect real hit/impact outcomes, not only projectile artwork. Proposed deterministic shot/volley dispersion includes distance and movement; exact spread and friendly-fire policies need agreement. Early naval cannon, Late Medieval field guns and Early Modern firearms need appropriate inaccurate profiles; Modern improves accuracy without a blanket guaranteed-hit rule.

Slow Early Modern firearm reload limits firing cadence even after a successful hit; armour reduces the damage received by the target without changing that cadence. Keep these controls independent so more durable squads do not require confusing accuracy or reload workarounds. Fire-and-retreat retains normal cooldowns, movement penalties and real misses. Formation tactics cannot reset reload or grant guaranteed synchronized hits.

Update promotion benchmarks for actual capacities/HP, armour, accuracy and reload, comparing full older veterans to full next-tier recruits in the corresponding branch. Also inspect equal-manpower/cost matchups separately. Existing fixed-1,000 damage normalization and UI meters are source integration risks, not the new intended rules.

## What changes from the current skirmish

The earlier prototype observation was DPS-oriented. The current September 30 source now includes separate attack/armour profiles and charge definitions in `domain/Definitions.ts`, XP/damage/reload handling in `domain/Combat.ts`, and refit/charge state in the simulation. Reuse those domain foundations. Remaining gaps for this addition include definition-tier capacity, accuracy/spread, updated fixed-1,000 consumers, and cohesive army/tactical state. This planning update does not claim that source changes elsewhere in the workspace were made or runtime-validated in this task.

Preserve troop strength/health and movement state already required by the simulation. Replace the DPS-first definition with attack profiles and effective stats. DPS can remain a derived comparison (`attack damage / reload time`) but is not an independent value that can drift away from the actual attack cadence.

## Stat contract proposed

Also expose current/max squad strength or HP and the attack's accuracy behaviour alongside the existing stats. If accuracy varies by distance/movement, show the applicable range/context rather than one misleading unconditional hit percentage. HP, armour, reload, projectile size and blast radius remain distinct values.

| Player-facing stat | Meaning                                             | Domain representation / rule                                                                                                                                      |
| ------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Melee Armour       | Protection against melee-class attack packets       | Nonnegative authored defence value interpreted by the shared armour policy.                                                                                       |
| Ranged Armour      | Protection against ranged-class packets             | Separate value; projectiles/firearms ordinarily use this channel.                                                                                                 |
| Melee Attack       | Damage of a completed melee attack                  | Damage per attack event, not per animation frame or per second. Zero / unavailable when the definition has no melee profile.                                      |
| Ranged Attack      | Damage of a completed ranged attack/volley          | Damage per attack event. A volley must specify whether the value is aggregate or per projectile; do not charge it once for each illustrated soldier accidentally. |
| Range              | Legal target distance for the active attack profile | Fixed simulation-distance units; convert to map cells for display. No firing through blocking rules that the domain says are impassable.                          |
| Reload Time        | Time until another normal attack can occur          | Simulation ticks/duration. Each authored attack profile owns its cadence; UI shows the current profile when a unit has alternatives.                              |
| Charge Speed       | Movement during committed charge execution          | Separate from ordinary speed, with acceleration/run-up and maximum travel authored for the ability.                                                               |
| Charge Damage      | The charge's impact damage budget                   | A separate ability event, not normal DPS multiplied by movement speed.                                                                                            |
| Charge Reload Time | Ability cooldown                                    | Independent of weapon reload; displayed as Ready or remaining simulation time.                                                                                    |
| Projectile Size    | Physical projectile collision footprint             | World-distance value, proposed diameter/radius convention below; independent of source pixels and visual scale.                                                   |
| Blast Radius       | Area affected by impact/explosion                   | World-distance radius, separate from projectile size; zero for attacks without splash damage.                                                                     |

Use explicit damage channels and target capabilities. Being in the Melee art folder does not grant a sword attack to short-gun or rifle infantry. A pistolier may have a ranged profile without a melee charge. Structure damage and fortification resistance remain explicit target rules; neither troop armour column automatically defines wall integrity.

Suggested armour model for review: display bounded percentage reduction, resolve damage as `attack * (1 - armourReduction)`, and cap protection below immunity. Charge penetration scales the relevant reduction by `(1 - penetrationFraction)` before resolving damage. Example: 40% melee reduction with 25% penetration becomes 30% effective reduction, rather than zero armour. These are explanatory values, not unit stats. An armour-points curve is also possible, but choose one shared domain policy before authoring the stat tables.

Do not multiply two separate melee/ranged armour reductions against the same packet. Charge initially uses its declared channel, proposed melee; AoE does not imply true damage. Crossbow penetration and explosive/air/strategic damage policies require explicit profiles rather than special-case tests in the UI.

Reload and damage advance on simulation ticks, respecting pause and speed. Animation markers align presentation with an authoritative attack event; the animation cannot independently inflict damage, grant XP or finish a cooldown.

## Projectile and blast contract

Keep Projectile Size, Blast Radius and rendered sprite scale separate. A small shell may have a wide explosion; a large missile silhouette need not have a large collision target. The 314px artillery-effect and 627px bomb-effect artwork do not establish a two-to-one gameplay radius.

Proposed size convention: Projectile Size is world-space collision diameter, with an internal radius of half that value; Blast Radius is explicitly a world-space radius. Label these units in the unit/attack detail and use fixed-point distances. The convention is a proposal to adopt consistently, rather than allowing different weapon families to interpret Size as diameter, radius or texture scale.

| Weapon/profile               | Projectile Size                                                                   | Blast Radius / damage role                                                            |
| ---------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Battering ram / lance charge | Not applicable; contact geometry belongs to the unit/ability                      | Charge impact radius is an ability property, not projectile size.                     |
| Arrow/crossbow shot          | Authored narrow collision footprint when using simulated projectiles              | Usually zero splash; explicit direct-hit damage.                                      |
| Catapult/onager/trebuchet    | Authored stone collision footprint                                                | Small area, strong structure role and explicit falloff.                               |
| Cannon/artillery shell       | Separate shell footprint and flight profile                                       | Authored impact blast; no per-frame repeated damage.                                  |
| Conventional aerial bomb     | Bomb footprint and authored drop/flight profile                                   | Explosion radius separate from the bomb's silhouette.                                 |
| ICBM / strategic payload     | Launcher/flight projectile definition may reference a distinct warhead definition | Authored detonation radius and target effects; no inference from its explosion atlas. |

An attack profile references projectile and damage definitions rather than treating one Size stat as every physical/combat parameter. Projectile speed, flight/lifetime, collision categories, range and interception policy still need authoring; adding Size alone will not make siege/air combat work.

For moving projectiles, resolve swept movement from previous to next tick position, accounting for collision radius, so a fast shell cannot pass through a thin target between samples. Use a broad-phase spatial query followed by the appropriate precise collision test. Resolve the earliest valid impact deterministically, with stable-ID tie breaking, then create a single impact/detonation event. Replayed/duplicated impact events must not damage or grant XP twice.

At impact, query valid targets within the authored blast radius, apply the agreed distance falloff and armour/structure policies once, and preserve an explicit total damage budget. Friendly/allied eligibility, walls/line of effect, air/ground filters and strategic exceptions remain authored combat policy. Do not make all explosions bypass walls or both armour channels merely because the visual looks large.

Render projectile/explosion art from these events with independent art scale and duration. Optional impact previews show the actual proposed damage radius. Smoke/fire artwork may extend beyond it, but the tactical preview cannot promise a different damage footprint. Explosion animation frames neither repeatedly apply damage nor create continuous burn damage unless an explicit damage-over-time effect is authored.

The left attack/siege/bomb detail shows Projectile Size and Blast Radius when applicable. A rifle hitscan profile or ram should show Not applicable rather than a fabricated projectile size. Technology previews identify which capability gains these properties without pretending to have final numerical combat values.

## Modern targeting and defensive positions

Anti-air vehicles target aircraft only, as confirmed; they do not intercept ICBMs, MIRV carriers or warheads. Missile defence is a separate capability. Use explicit target categories and interception policies: a shared airborne flag would incorrectly merge aircraft combat with strategic-projectile defence.

Gun nests use their own weapon profiles. Trench cover is a contextual combat modifier with an explicit occupancy/access policy, not a permanent promotion or a visual increase in base armour. Present effective defence consistently and bound stacking with armour/promotion effects. Existing walls retain their barrier policy in Modern; a trench must not silently inherit it.

MIRVs separate the launcher, carrier and individual warhead definitions. Projectile Size applies to each simulated projectile; Blast Radius applies to the detonating payload. Splitting produces a finite authored set of child events, not automatic parent splash plus duplicated child damage. Carrier/warhead target eligibility, split timing, interception and total damage budget need authored domain contracts. See [Modern defences and strategic weapons](modern-defences-and-strategic-weapons.md).

## Promotion progression

Level 1 is a new recruit. Levels 2-5 use the existing green-star rows; level 6 uses the gold ring, and level 7 the purple/gold ring. Level is independent of empire age, equipment definition, culture and faction colour.

| Promotion level | Existing icon              | Illustrative total effectiveness budget over this definition's recruit |
| --------------- | -------------------------- | ---------------------------------------------------------------------- |
| 1               | One green star             | 0%                                                                     |
| 2               | Two green stars            | ~3%                                                                    |
| 3               | Three green stars          | ~6%                                                                    |
| 4               | Four green stars           | ~10%                                                                   |
| 5               | Five green stars           | ~13%                                                                   |
| 6               | Five-star gold ring        | ~16%                                                                   |
| 7               | Five-star purple/gold ring | ~20%                                                                   |

These are benchmark budgets, not a modifier applied to every stat. Adding 20% attack, protection, reload improvement and charge damage independently would far exceed a 20% total increase. Allocate a bounded budget among authored attack/reload/protection improvements; keep range and charge geometry stable unless a specific definition justifies changing them.

An illustrative next-age recruit baseline around 30% above the older recruit leaves a 20%-improved veteran at about 92.3% of that next-age recruit's benchmark effectiveness. Target roughly 5-10% below the next-age recruit, then verify real combat. Do not copy that scalar onto every branch or assume raw DPS proves the target.

**The promotion ceiling requires combat benchmarks.** Range, armour, reload, movement and charge interact; a single multiplier cannot make an older veteran lose by exactly the same small margin in every matchup. Preserve counters. Compare corresponding branches with equal formation strength and controlled starting positions across their intended roles, including charge available/unavailable, melee/ranged targets and structure attacks. The pistolier-to-tank transition especially needs role benchmarks, not a promise that every individual duel has the same result.

Proposed XP rules:

- Credit effective hostile damage actually applied, not attempted damage, friendly/allied damage, overkill, or animation events.
- Award a modest kill bonus once for the authoritative defeat, with assist attribution determined from combat records. Damage XP and kill bonuses must not become two full payouts for the same work.
- Award objective XP for authored contested military objectives, with stable event IDs and participation requirements. Prevent repeated ownership toggles or empty-territory travel from farming promotions.
- Civilian trader income/prize returns do not grant combat XP automatically. If interception is an objective, define a bounded once-per-shipment award explicitly.
- Keep XP with the formation entity, capped at level 7. Recruitment creates a level-1 entity. Replenishment does not create free XP; any dilution policy remains open.
- On successful age refit, assign the target definition and reset XP/promotion to level 1 atomically. If a refit is cancelled or fails before completion, do not partially reset the old unit.

Thresholds, objective list, assist division, casualty/replenishment treatment and whether naval/air units promote remain to be authored. XP does not spend gold and a technology purchase does not award promotion.

## Charge roster in the base-tree proposal

| Technology               | Candidate charge definition | Intended role                                                                        |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------------ |
| S-W3 Horsemanship        | Mounted spearmen            | First modest charge, vulnerable during recovery.                                     |
| B-W3 Chariot Warfare     | Chariots                    | Broader physical formation; geometry and turn limits must differ from a lone rider.  |
| C-W3 Cavalry Tactics     | Mounted swordsmen           | Mobile flank impact.                                                                 |
| EMed-W3 Mounted Spearmen | Medieval mounted spearmen   | Improved mounted impact against an exposed formation.                                |
| LMed-W3 Lance Knights    | Knights                     | Strongest traditional lance impact, bounded by long recovery and counters.           |
| EMod-W3 Pistoliers       | No melee charge by default  | Mounted ranged mobility/fire; a firing burst would be a separately authored ability. |
| M-W2 Combined Arms       | No tank charge by default   | Armoured fire/support; ramming is not inferred from the old cavalry slot.            |

This roster is proposed, not a restriction that prevents later infantry charges. Any added charge lives on its unit definition or explicit capability bundle; it does not silently create another counted research node. Traders, transports, aircraft and strategic payloads do not inherit mounted charging behaviour.

## Charge lifecycle and small-area impact

Model Ready -> Approach/Run-up -> Committed Charge -> Impact -> Recovery/Cooldown, with explicit abort/failure transitions.

1. Validate owned eligible entity IDs, current ability readiness, target position/entity, domain reachability, and allowed distance. A UI quote is not authoritative permission.
2. Stage/run up along a valid navigable corridor, then accelerate under the ability profile. Walls, water, formations and gates retain their shared blocking policies. Charge cannot jump an intact wall or acquire illegal speed from a route shortcut.
3. Snapshot or otherwise bound the committed direction/target during the run. Limit turn/retargeting so charge is a tactical commitment, not a permanently accelerated homing attack.
4. At the authoritative contact/end point, resolve one impact pulse in a small authored radius against valid hostile targets. Partial armour penetration applies to each victim's appropriate armour channel. Suggested starting experiments: radius around 1-1.5 cells, penetration around 20-30%, distance falloff and a bounded victim/damage budget.
5. Start cooldown under one explicit commit/abort policy. Recommend consuming the charge once committed even if it misses, to prevent cancellation/retry farming. Rejected commands consume no cooldown. Approach cancellation before commitment is a separate policy to settle.
6. Recover and return to an explicit normal order/profile; do not also apply unlimited contact damage every tick during the same charge. A normal attack landing at the same tick needs a defined combination policy.

An area target is a world position, not a fabricated enemy. A miss can spend the committed charge. Enemy movement, death, capture/relationship changes and newly built barriers must be checked during execution. Proposed initial AoE excludes friendly/allied targets, but strategic friendly fire follows its separately authored policy.

Use the existing spatial index for local queries, stable victim ordering and bounded work per pulse. Do not scan every troop for every charging unit. If a multi-unit command charges several formations, define impact ownership/overlap so one formation cannot hit the same victim repeatedly from duplicated command or collision events.

## Double right-click, selection, and UI

Right-click already issues tactical orders. Recognise the two-click gesture deliberately; do not immediately commit two ordinary orders and then append Charge as a third command. Track right-button releases, time separation and a small screen-distance tolerance; suppress gestures beginning over UI, panning or placement controls. A roughly 250ms window is a proposal to test, not a hard-coded rule yet.

The input layer must choose a clear single/double-click policy. Prefer one small gesture interpreter that defers the ordinary order until it knows whether a double gesture is complete; measure the resulting single-click latency. An immediate first order that is replaced by a later charge is an alternative only if replacement is explicit, deterministic, and cannot create duplicate effects. Do not rely solely on browser `dblclick`, whose handling of secondary-button clicks varies.

Capture stable selected IDs and target intent for the command; selection changes cannot charge a newly selected army accidentally. Mixed selection must expose the eligible count and treatment of non-charge units. Proposed behaviour is to charge explicitly eligible units and leave the rest on their prior orders, with visible eligibility; agree this before implementation rather than silently issuing an affordable/ready subset.

In the left card, show the six core stats for the actual selected definition plus Charge Speed/Damage/Reload where supported. Show promotion icon/level, XP progress, charge readiness/cooldown and an accessible Charge action for players who cannot use a double click. Upgrade preview states the new definition, agreed refit cost/time and **promotion resets to recruit**. A group with mixed definitions/levels must not report a false uniform card.

Combat cards use effective domain read models so promotion modifiers appear consistently. Research preview separates baseline definition from the selected formation's promotion. The star overlay retains its original colours beneath the faction-tinted formation marker.

## Architecture and acceptance

No departure from MVVM or Domain-Driven Design is required.

- Authored definitions own attack profiles, defence policy inputs, promotion curves and optional charge capability. Progression resolves availability; it does not inflict damage.
- Combat domain owns attack/reload timing, damage resolution, XP attribution and charge execution. Shared navigation/relationship policies constrain movement and target validity.
- Application commands carry explicit selected IDs and target intents to worker validation. Authoritative state changes occur once; duplicate UI gestures cannot cause duplicate impacts or XP.
- Snapshots expose definition/promotion/effective stats and ability state according to the visibility policy. ViewModels format cards/eligibility/cooldowns; views draw stars and recognize gestures.
- Ruleset identity includes combat curves/recipes so future replays/network clients agree on promotion and damage. Use deterministic integer/fixed-point arithmetic and simulation ticks for authoritative calculations.

Before shipping, verify both armour channels, attack cadence under pause/speed, partial penetration, misses/aborts, charge against walls/gates, small-area falloff/overlap, swept projectile collision, independent projectile/blast dimensions, impact deduplication, duplicate commands, relationship changes, XP conservation/farming prevention, seven-level icon mapping, refit reset timing, older-tier recruitment, same-branch promotion ceilings and mixed-selection input. Runtime combat/balance work remains necessary; this plan does not establish those results.
