# Responsive movement gameplay contract

Authorized by the user on 13 October: fun, responsiveness and readability take
priority over natural-terrain footprint accuracy. Ordinary Move fights blockers;
it may abandon its original destination rather than continually push through.

- Land and amphibious routes may cross natural impassable mountain tiles.
  Existing terrain speed remains; map generation, building placement and tile
  ownership rules retain their existing terrain data.
- The carrier determines land/water legality. Formation edges and soldier
  artwork may overlap mountains and water. Non-amphibious carriers cannot cross
  water; transport transitions remain authoritative.
- World bounds, walls and building obstacles remain physical constraints.
  Exact geometry is retained near constructed obstacles and enemy contact.
- Destination planning ignores other squads, including their queued endpoints.
  Selected members still receive deterministic formation slots. Live execution
  can be blocked by enemies, but that does not invalidate an admitted goal.
- A moving squad already in legal close contact with a hostile combat target
  changes to Attack, releases its move-route work, and discards the interrupted
  destination. Explicit queued orders remain available afterward. Distant
  ranged acquisition alone does not interrupt movement. Charges and transport
  movement retain their specialized behavior.
- Only enemies ahead of the current movement leg interrupt it. An order away
  from contact remains a withdrawal. Specialized cavalry withdrawal is exempt.
- A defended shore reserves carrier space when landing; it does not require an
  entire empty infantry footprint. Outer-body overlap can engage immediately.
  A land carrier cannot occupy the defender's carrier space, and crossing water
  completes before a far-bank formation edge interrupts the march.
- Tactical feature checkpoints identify the new connectivity rules. Migration
  of older saves recomputes legacy components and passages, verifies their
  source and feature hashes, then rebuilds the derived index under new rules.
  Unknown map fingerprints or corrupt feature hashes still fail validation.
- All changes apply to AI and player squads. Canonical simulation stays at
  20 Hz; no population cap or camera-dependent combat is introduced.

Validate mountain routing/reshape completion, shoreline carrier legality,
enemy-occupied drawn/admitted destinations, move-to-combat transitions, queued
orders, walls, transport, restore and determinism. Measure the same dense replay
against an archived pre-change source, with other matches and development
servers stopped. Report measured gains and remaining limits; do not claim
late-game stability from a short average alone.
