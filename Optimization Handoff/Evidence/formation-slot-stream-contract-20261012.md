# Local formation slot replication contract

The rendered replay still costs roughly 60–76 ms for simulation and another
10 ms for encoding and publication. Decode costs about 10 ms and presentation
about 8 ms on the client. The 1x target remains unmet. Captured immutable
formation arrays are repeatedly serialized and parsed while revisions and
transition timestamps change. Internal ownership transfers now preserve those
array identities.

Introduce packed detail version 5 as an opt-in for the local worker. Hosted
encoders retain version 4 by default. Both versions remain readable. Geometry,
orders, troop counts and canonical checkpoints remain unchanged.

The encoder owns a dictionary for `trail`, `transition.fromSlots`, and
`occupationSlots`. A detail row references immutable arrays by ID. New arrays
are transferred once as typed coordinate buffers. Per-squad references own
dictionary entries; changing/removing a squad releases unused entries. The
live table is bounded by three arrays per admitted squad, with 144 slot points
or 256 trail points per array. Baselines and encoder recovery reset the table.

The decoder validates updates into a prospective dictionary before resolving
any references. Missing IDs, duplicate/conflicting updates, invalid coordinate
buffers, unsupported kinds, malformed IDs and excess retained entries reject
the packet. Resolved point arrays are frozen. Their element validation can be
reused, while formation shape, count, endpoint and tick-dependent checks still
run for each row. A rejected packet must not commit dictionary changes.

Each decoded squad owns its formation and transition objects. Shared dictionary
arrays are immutable. Legacy inline arrays retain their existing validation.
All arrays in new updates participate in the existing transfer-list ownership
handoff. Negative zero follows the existing JSON projection behavior.

Qualification includes exact projected-state comparisons against version 4,
unchanged-array reuse, replacement/removal, reset/recovery, malformed references,
validation before commit, immutable sharing and bounded retained entries. Run
the same canonical replay through both formats and compare final checkpoints.
Then measure browser worker publication, decoding, presentation and real pace.
This pass alone does not establish the simulation capacity target.
