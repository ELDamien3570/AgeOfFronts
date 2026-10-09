# Normal skirmish recruitment migration

The complete eight-age runtime migration was explicitly approved on 2026-10-07
and is registered in normal skirmish. Start a new match to use the new catalogue;
old saved matches and clients with the previous content hash are not compatible.

## Implemented

- Eight distinct eras: Stone, Bronze, Classical, Early Medieval, Late Medieval,
  Napoleonic, Early Modern and Modern. Economy, equipment, opening inventories,
  faction/army limits, transport capacity and UI tables have entries for all eight.
- All 42 available planned troops, with their authored names, research prerequisites,
  gold prices and training seconds. Six troop classes share the existing three
  movement/collider families and cohort strength; no individual-soldier simulation
  or network entities were introduced.
- Named specialist recruitment controls for spear infantry, heavy cavalry and ranged
  cavalry. Existing infantry/ranged/cavalry hotkeys remain tied to the primary classes.
- A validated 259-node research catalogue includes required warfare prerequisites,
  supported building tier unlocks, siege support, aircraft and strategic unlocks.
  Research graph validation checks closure, cycles, valid eras and unique identities.
- Bronze Spearmen require Bronze Equipment directly. Horse Archers and Druzhina
  use their named unlocks. Current-era opening grants include the frontline unlock
  and actual prerequisite closure; other current-era troops still need research.
- Authoritative recruitment enforces research, producer, producer tier, inventory,
  reserves, queues and training time. Refit preserves the troop class. Cancellation
  and destroyed-producer handling use the normal paid-job lifecycle.
- Infantry/ranged/spear/cavalry profiles use AoE2 as a reference, adapted to squad
  attrition. Ranged troops beat infantry with a firing head start; infantry wins on
  contact. Spear duels beat same-era cavalry and lose to next-era light cavalry.
  These numeric profiles remain a first balance pass, not complete match balancing.
- Explicit upgrades: radios/optics +10% applicable infantry attack each; tank fire
  control +10% attack; tank armour +20% durability; naval missiles +15% Modern warship
  attack and +1 tile range. Durability normalizes damage while preserving cohort
  strength and existing network shapes. Precision Manufacturing uses factory throughput.
- Russian building command previews, placement ghosts and placement tooltips.
  Ready soldier artwork supplies 29 recruitment portraits through the same explicit
  age/class bindings as the planner. Source art remains unchanged.
- Attack approach pressure and persistent slot caches now survive checkpoints;
  otherwise restored AI targets diverged before the next movement rebuild.

## Deliberate scope boundaries

The existing economic/naval baseline dependency graph and effects remain supported.
The entire future planner economy/naval graph is not registered. Drone swarms,
submarines, railway, refinery/warehouse facilities and other unfinished mechanisms
remain unavailable rather than receiving inert research nodes.

Normal local and online skirmish now share the individual-soldier renderer with
its isolated prototypes. The 42 complete Russian actor sets use unique age/unit
keys, lazy decoding and fixed-pivot runtime frames (128px soldiers, 256px vehicles). Foot cohorts display 12
soldiers and cavalry display six, with mobile mass as the default. At fewer than
12 pixels per map cell, icons replace soldiers and detailed motion/picking stops.
Selection follows soldier anchors; right-drag deployment previews soldier circles.
Manual shape controls remain cosmetic, client-local presentation, as in the demo.
New local and hosted matches enable the validated formation locomotion, in-place
reorientation and continuous queued travel modes. Saved match options are unchanged.

All 42 troop definitions now have authored bindings. The Napoleonic Cossack Lancer
uses the accepted lancer set under the legacy EarlyMedieval/CossackRider folder;
its source equipment matches the planned lance/coat role, and source directory names
do not override runtime ages. `Art/Runtime/Russians/Troops/MissingAssets.json` records
any future missing binding/clip and is currently empty. Source clip aliases (moving/running and moving-shooting/attack) are resolved
explicitly. Anti-cavalry infantry now correctly recruits at barracks without horse
costs and displays 12 members; it is never classified as mounted by a name suffix.
Siege and other non-cohort actors retain their existing renderer.

Vehicle groups are one Tsar Tank, T-34, T-14 or Tunguska, or two Gun Trucks/Bumerangs.
Mass uses a staggered pair; line puts pairs abreast. Hull widths are fitted once to
the opaque idle envelope against the Clubman shoulder reference (about 0.65m).
Representative hull dimensions are approximate visual design inputs, not physical
map units or collision geometry. T-34 chassis reference: [US Army equipment guide](https://man.fas.org/dod-101/sys/land/row/weg2001.pdf).
The unusually large Tsar Tank is intentionally much larger. Hull gaps may exceed
nominal squad collider footprints, as already permitted for cavalry.

`RussianActorCalibration.json` stores fixed normalized throwing-hand/barrel positions,
multiple emitters and facing offsets. Volleys and authoritative squad projectiles
reconstruct visual launches from current individual poses, then retain them through
movement and source retirement; authoritative arrival ticks and impacts are unchanged.
Vehicles produce wrecks rather than ground blood. No per-member damage entities exist.

All supported planner nodes now use the saved page's names, prices, times and safe
prerequisites. Eleven additional upgrades have real effects: bayonet/volley attack,
artillery speed, copper-sheathed warship speed/hulls, merchant cargo, manufacturing
throughput and modern transport durability. Supply Depots currently adds 5 throughput
percentage points; a separate storage-capacity mechanic is not present. Vessel effect
caches include the effect set so one faction cannot inherit another's research.
Fleet Operations and Integrated Logistics retain their supported runtime prerequisites:
the planner now gates them behind unfinished submarine/radar and refinery/rail systems.
All unavailable nodes and those two exceptions are listed in `RuntimeTechnologyGaps.json`.

Cleanup removes only unreferenced generated Russian runtime images and superseded
actor sets. Cohort bindings to the legacy baked atlases are removed. Authoring masters,
SourceArt, historical revisions and existing review pages remain intact.

## Sources and verification

`scripts/compileRussianRecruitment.ts` compiles the saved Russian plan into
`src/skirmish/content/russian-recruitment.json`. The authored plan is not rewritten.
`RussianTroopArtwork.json` owns the shared explicit troop portrait bindings;
`scripts/prepareRussianArtwork.py` prepares bounded runtime images. `scripts/prepareRussianTroopActors.py` bakes
the complete solo actor clips and records source hashes in each runtime manifest.

Tests cover every troop through authoritative rejection, payment, queue completion,
UI availability, snapshot serialization and checkpoint restoration; legal research
traversal covers all registered nodes. Additional checks cover class controls,
production, starting ages, cancellation, counter duels and deterministic replay.
Browser verification and a production build are local evidence, not multiplayer
release qualification or a finished art/balance review.

Latest full-roster verification (2026-10-07): typecheck and production build passed;
18 focused test files / 171 tests passed. The browser actor audit decoded all 42
sets and drew 362 representative members with no page errors. Normal modern
skirmish displayed the AK-47 set and stopped individual draws below the icon cutoff.
These checks establish local integration, not multiplayer deployment or load certification.
