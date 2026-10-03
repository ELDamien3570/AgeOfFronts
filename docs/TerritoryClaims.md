# Automatic territory claims

Neutral land enclosed by a single country fills inward one boundary layer every
10 game seconds. Water may complete an enclosure, but there must be an owned
land boundary. Open map edges, connections to other neutral regions, and foreign
land boundaries block automatic claiming. A building on still-neutral land
protects that pocket.

A qualifying pocket must fit both limits: 25% of the recipient's currently owned
land and 5% of the map's land. A larger pocket is rejected as a whole; its edge
does not gradually shrink it into eligibility. Existing hostile one- or two-cell
pocket absorption remains unchanged.

Neutral coastal water advances from owned shoreline one layer every 20 game
seconds. Nearby owned boats double progress; overlapping boats do not stack.
Boats cannot create territory away from shore or extend its maximum reach.
Equidistant competing shores leave neutral water contested. This system does
not automatically take another country's water.

Distances scale with the map's longest edge, using 500 cells as the reference:

| Longest edge | Offshore oil band | Water claim reach | Boat acceleration radius |
| --- | --- | --- | --- |
| 250 | 3 tiles | 4 tiles | 2 tiles |
| 500 | 6 tiles | 8 tiles | 3 tiles |
| 1000 | 12 tiles | 16 tiles | 6 tiles |

Oil generation and rig placement use the same distance band, measured in water
steps from land. Rigs require an oil deposit, owned water, the appropriate
technology, and normal construction costs/spacing. Neutral or deep-ocean sites
are invalid. AI countries can also build rigs on their claimed oil deposits.

Water ownership is separate from land accounting, income, and land-based
promotion thresholds. Rights track their originating shore; losing that shore
relinquishes dependent water, and another coast can subsequently claim it.
Elimination transfers both land and water through the existing conquest policy.

Ownership changes remain authoritative simulation operations. The enclosure
search has a per-tick work budget; pending waves, unfinished searches, and coastal
progress are checkpointed for deterministic recovery. These rules affect new
matches and require deploying the updated client and server together.
