# Isolated Stone / Bronze playable skirmish

Run the existing skirmish Vite server and open:
`http://127.0.0.1:9019/tests/skirmish/browser/StoneBronzeSkirmish.html`.
The 9019 port belongs to the local experimental server. A fresh default skirmish
server uses port 9000; substitute that port in the link.

This page registers a local client profile before importing the normal skirmish
entry point. It uses the normal worker, terrain loading, spawn selection, AI,
economy, recruitment, equipment, research, control groups, combat, and victory.
Default setup: Training Square, Stone start, three AI opponents. The size selector
starts at 250; Training Square uses the normal loader's fixed 256-cell downsample.
New skirmish retains the normal map/opponent settings and allows Stone or Bronze
starts. The authoritative `maximumAge` option stops every faction at Bronze.
It is carried in expansion snapshot metadata and checked by research UI, AI
planning, and authoritative advancement. Normal matches omit the option.
This entry point always runs locally, including when a match query is present;
it is not part of the production build's entry list and is not deployed.

Artwork-only mapping of the six normal roles:

| Gameplay definition | Russian individual artwork |
| ------------------- | -------------------------- |
| stoneage-infantry   | Stone Clubman              |
| stoneage-archer     | Stone Javelinist           |
| stoneage-cavalry    | Stone Scout                |
| bronzeage-infantry  | Bronze Axeman              |
| bronzeage-archer    | Bronze River Archer        |
| bronzeage-cavalry   | Bronze Light Cavalry       |

Gameplay names, costs, stats, technology gates, and equipment requirements remain
the normal roster. Extra art such as Bronze Spearman is not a new gameplay unit.
Siege units and ships retain normal artwork. All six sprite actors have materialized
idle/run/attack/death sheets. Shared templates, choreography, body/blood lifetimes,
volleys, stable shared-layer ordering, and world size match the existing troop demo.
Foot formations show twelve soldiers; cavalry shows six. Bronze sizes use approximate
fixed shoulder/rider widths of 300/240/164 px against Clubman's 340 px reference;
original sheets and manifests are unchanged. Visual acceptance remains separate
from metadata/source checks. Refit reshapes existing cosmetic actors with the new
artwork scale while preserving soldier identity and casualty tracking.

Mobile Mass is the default for every mapped foot and cavalry squad. Select foot
squads to try Mass, Line, Shield wall, or Square in the existing demo panel.
These controls change client presentation only, including ranged foot formations;
they grant no combat bonuses or collider changes. Cavalry defaults to mass; charge
orders automatically form a wedge and then return to its selected layout. `formationLocomotion` is enabled in this match
so authoritative squad turns/acceleration/charge alignment use the prototype's
movement limits. Pause and speed affect the soldier presentation clock too.
Bodies stay 20 seconds at 95 percent size; blood fades to 45 seconds. Reset clears
all per-match cosmetic state. The panel can collapse and reports actual drawn
soldier count, render CPU, and frame rate.

Validation includes materialized art checks, human and AI age-cap rejection without
payment, permitted Stone-to-Bronze advancement, normal-match Classical advancement,
AI candidate filtering, full/delta snapshot transport, checkpoint restore, and
existing movement/choreography/research tests. HTTP/Vite checks do not establish
browser rendering correctness or browser FPS; record those separately.

## Turn-in-place travel reorientation

This local profile also enables `formationReorientation`. The squad still brakes
before a sharp reversal, then uses a 360 degree/second foot or 240 degree/second
mounted turn envelope. Its collision footprint and top travel speed are unchanged.
The visual layout follows the requested facing directly; this frame is not the
physical facing of any soldier. On heading changes, current soldier poses are
re-expressed in the new frame and assigned to available ranks by minimum squared
travel distance. Full symmetric line half-turns preserve world positions and
swap which existing rank is the front. Quarter turns and asymmetric wedges use
short immediate reshape tracks without a whole-group circular march. Casualty
identities and previously captured body/blood positions are preserved.

Individual pivots use bounded 540/360 degree/second foot/mounted rates and angular
acceleration. Followers brake and face within 15 degrees before following the new
travel slots. Charge preparation retains its authoritative alignment gate. Engaged
combat still uses independent opponent-facing; explicit move orders disengage the
visual combat hold. Travelling squares face the travel direction and resume their
outward combat attention when engaged. This mode is opt-in for this demo; legacy
formation turning and normal skirmish movement retain their existing behavior.

## Zoom detail and selection

At 12 pixels per map cell and above, mapped land squads show individual soldiers.
Below 12, they use the normal faction-colored formation icons. Soldier followers,
formation choreography, contact processing, individual volleys, and casualty draws
are suspended in icon mode; authoritative gameplay continues normally. Sprite
textures remain cached. On returning to detail, soldiers start at the current
squad strength rather than replaying missed deaths. Previously captured remains
retain their original world positions and expire against the match clock.

Detailed squads omit the root underlay/capture circle. Selected or inspected squads
instead receive small rings under their living soldiers. Ranged weapon range and
order paths remain. Click and drag selection use cached visible soldier positions
from the completed render frame, with the normal squad-root fallback. This does
not expand gameplay collision or attack range. Overlapping clicks prefer the
nearest soldier, then the uppermost stable squad ID on exact ties. Icon mode clears
the detailed hit cache and returns to ordinary icon selection.

## Draw army frontages

Select land squads, then hold the right mouse button and drag to draw a deployment
line. Faction-colored circles preview each living soldier's destination in its selected
internal formation, using the same size and cavalry rank spacing as the actors.
Reversing the drag reverses facing. Release sends one authoritative group order;
ordinary right-click still moves or attacks. Shift-drag queues the line. Ordinary Shift-click moves after deployment translate
the last queued layout as a whole, preserving squad assignments, relative spacing,
and final facing, including after arrival. Escape
or pointer cancellation discards the preview. Drag width varies the lateral gap continuously; squads can close to 2 cells between
centers before excess squads wrap into further ranks. Extra ranks grow 3 cells
behind the drawn front rank, fill front ranks first, and center incomplete rear
ranks. Wider drags spread squads farther apart. Shift movement preserves both the
rank layout and its exact gaps. Each squad keeps its selected internal shape.

The client and simulation share line geometry and projection-based slot assignment.
The domain checks every destination, ownership, refit/embark state, terrain, enemy
clearance, connectivity, and queue capacity before mutating orders. Blocked slots
reject the deployment rather than fall back to a different arrangement. Routes use
the existing bounded navigation scheduler when deferred planning is enabled. A
queued line waits for any previous group admission to finish; attempts during that
brief pending state report a rejection without discarding the previous move.
Formal army coordination is suspended by explicit member deployment, so it cannot
repack the requested line. Final facing is kept on arrival and carried by the
existing six-integer order rows using an optional flag and micro-radian value;
legacy rows and ordinary orders retain their encoding. The drawing gesture is
opt-in for this isolated page, not enabled on the normal skirmish entry point.

## Mobile mass default

This skirmish now defaults to a stable circular crowd: twelve foot soldiers in a
loose filled cluster and six mounted soldiers with horse-length clearance in every
direction. Soldier size stays at the audited value. The mass layout uses a fixed
world orientation, with independent travel-facing on soldiers; turns do not rotate
its slots or compile reorientation tracks. Casualty filling and formation changes
still use the existing choreography. Charging selects the existing wedge.

Loose travel tolerates 0.06 cells of position error and uses softer slot corrections.
Soldiers can pivot while moving, with the existing bounded angular acceleration,
travel acceleration, braking, speed limits, and arrival-plane protection. Engaged
soldiers retain planted combat footwork and opponent-facing. The isolated match enables crowd velocity steering: route corners change the
velocity within the existing acceleration envelope without stopping for facing
alignment. This applies to ordinary squad travel regardless of the selected visual
shape; charge phases retain their separate alignment controller. Top speeds and
collision admission stay unchanged. Soldiers face their own velocity in Mass, with
bounded distance-driven lateral drift and varied lag that relax on stopping.
No per-soldier simulation or network state is added.
The ordinary troop and art demos retain their previous default formations; this
profile opts into Mass. Controls and tactical formation gameplay remain prototypes.


Queued Mass travel now preplans one next move per squad through the existing fair
route scheduler. The speculative leg is checkpointed, validated against order and
obstacle revisions, and discarded on replacement or removal. Admitted route
points supply a bounded eight-point stopping-distance lookahead. A clear local
join allows intermediate queued destinations to hand off within two movement
ticks (minimum 0.12 cells), preserving velocity. Hairpins, unready routes, blocked
joins, non-move orders, and final destinations retain braking; the last destination
still arrives exactly and keeps its deployment facing. Planning budgets and
collision admission are unchanged, and ordinary profiles remain opt-out.


Waypoint progression uses a stable incoming-segment crossing gate as well as
near-arrival distance; the incoming heading is checkpointed and does not flip
when the squad passes the point. Local gates remain bounded to the route corridor,
and progression requires a clear admitted onward segment. Ordinary oblique bends
are distinguished from true reversals. Corner speeds use the lateral acceleration
capacity with a 0.18-cell reference radius, reducing speed on approach rather than
carrying excess velocity past the turn. Final arrivals taper velocity over six
simulation ticks and resolve the fixed-point rounding tail inside braking capacity.


Ordinary Shift movement in this profile now translates each squad's ID-owned
layout offsets instead of assigning a fresh facing-oriented destination grid.
Pending admissions use the same rule; selections above 30 squads share one source
layout captured incrementally within the existing work allowance, while keeping
placement cohorts bounded. Terrain and occupied slots can still require local
fallback placement. Drawn deployments keep their existing explicit facing.

Non-combat travel uses persistent cosmetic soldier lanes. A distance-sampled root
trail lets rear soldiers follow turns after the front; the lane coordinate basis
is established once rather than recomputed at each queued point. The frame bends
no faster than the crowd's radius permits. History is limited to 256 knots and
pruned by required rear depth. A bounded local spacing force applies only inside
the travelling squad, under the existing velocity limits. Explicit shape changes,
casualty filling, and charge choreography remain separate. Individual lane state
is client-only, clears at detail culling, and adds no soldier entities to simulation
or replication.
