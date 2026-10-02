# Automatic production and type priorities

Factories, blacksmiths, armories, arms factories, siege workshops, and vehicle
depots start production automatically once completed. Humans and AI use the same
paid-batch allocator. No materials or equipment are granted for free.

## Production panel

The panel has one card per owned building type, with total/ready counts and all
its recipe buttons. Research-locked recipes are visible but disabled. Automatic
priorities highlight the highest researched equipment tier or refined metal.
Factories can also make prerequisite iron for steel. When a newer equipment tier
has no obtainable inputs, automatic production can fall back to a sustainable
older pattern; active batches are listed separately from the priority buttons.

Click recipe buttons to select one or several priorities for that building type.
An empty selection pauses new batches of that type. Manual selections survive
age advancement, research, save/checkpoint restoration, and construction of more
buildings. New buildings inherit their type's selection. Per-type **Automatic**
and **Reset all to automatic** remove overrides. Resets and changed selections
never cancel or repay a funded batch: it finishes before that producer takes new
work. Automatic highlights update as newer patterns are researched.

Manual priorities use the same resource budget and bounded buffers as automatic
production. Multiple chosen equipment patterns share their category's buffer.
They do not turn every checked recipe into an unlimited repeating order.

## Allocation policy

Allocation runs once per game second, using stable IDs and integer comparisons.
It groups buildings and counts squads once per pass; it does not scan map tiles.
An existing paid batch continues every simulation tick at its researched speed.

Default empire-wide stock targets (including in-flight output) are:

- Troop equipment: max(12, ceil(living squads / 3)), capped at 36
- Vehicle equipment: max(2, ceil(living squads / 12)), capped at 6
- Siege equipment: max(2, ceil(living squads / 16)), capped at 4, plus the
  matching vehicle target because each Modern vehicle also consumes a siege kit

At the initial targets, that is 12 troop kits, 2 vehicle kits, and 4 siege kits.
Older automatic producer types keep only a two-kit reserve of their own highest
pattern; they do not reduce the newest tier's main buffer. The Modern recipes
consume 144, 60, and 80 steel respectively, rather than
stockpiling equal numbers of differently priced items. The least-filled category
relative to its target goes first. Ties favor troops, then siege, then vehicles;
within a category, newer patterns win ties. Paid output counts immediately toward
the target, so constructing many depots cannot multiply the empire's vehicle
buffer. Higher-capability factories are preserved for work that requires them.

The next scarce but obtainable batch reserves its available ingredients from
lower-priority automatic work. An affordable refining prerequisite is funded
before an older kit can reserve the same iron. Incoming refinery output is not
spendable until its batch completes. Unobtainable patterns do not hoard unrelated
materials. Factories maintain a 60-unit advanced-metal buffer and expand toward
actual equipment shortfalls, normally capped at 120 per metal. A selected
strategic recipe can expand this to at least one full batch's input cost. Payloads
remain lowest priority; human payload production requires an explicit selection.

## Equipment consumption

- Troop kits are made by blacksmiths, armories, and arms factories according to
  their existing compatibility and research rules
- Every siege kit is made by a siege workshop, including Early Modern and Modern
- Vehicle kits are made by vehicle depots
- Recruiting a siege unit reserves one siege kit when training is queued, spends
  no additional kit on deployment, and refunds that same kit if the training
  producer is lost
- Vehicles reserve both their vehicle and siege kits once
- Refit commands continue to use the shared unit-refit cost and remain atomic

The existing building-tier restrictions on recruitment are unchanged. Equipment
production retains its existing researched-pattern/compatible-producer rule,
without introducing a separate building-age requirement.

Legacy individual `produce` commands remain readable for existing replays, but
the Production panel now sends per-type priorities and reset commands. Applying a
type preference clears legacy plans on that player's matching buildings.

## Suggested playtest

1. Build a factory and relevant equipment producer after researching a pattern;
   confirm materials are paid and output appears without choosing a recipe
2. Unlock the next equipment tier and confirm automatic highlights update
3. Select an older pattern manually, advance/research, and build another producer;
   confirm both retain the chosen type priority
4. Add multiple depots with scarce steel; confirm troop kits continue receiving
   inputs and vehicle stocks stop at their shared target
5. Queue siege training; verify exactly one kit is reserved, and completion does
   not charge again
6. Use the global reset during paid work; confirm the batch finishes and all
   subsequent decisions use automatic priorities
