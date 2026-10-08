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
- A validated 248-node research catalogue includes required warfare prerequisites,
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
its isolated prototypes. The 29 complete Russian actor sets use unique age/unit
keys, lazy decoding and 128px fixed-pivot runtime frames. Foot cohorts display 12
soldiers and cavalry display six, with mobile mass as the default. At fewer than
12 pixels per map cell, icons replace soldiers and detailed motion/picking stops.
Selection follows soldier anchors; right-drag deployment previews soldier circles.
Manual shape controls remain cosmetic, client-local presentation, as in the demo.
New local and hosted matches enable the validated formation locomotion, in-place
reorientation and continuous queued travel modes. Saved match options are unchanged.

The other 13 troop definitions retain formation icons rather than unrelated legacy
atlases. This includes the Napoleonic pikeman and machine-gun truck, whose source
metadata currently contains only an idle clip. Siege and other non-cohort actors
retain their existing renderer. Existing audited body-size corrections are preserved;
newly integrated later-age sheets use fixed class baselines pending a visual size audit.

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
