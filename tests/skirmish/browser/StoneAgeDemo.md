# Four-faction Stone and Classical troop load demo

Open `/tests/skirmish/browser/StoneAgeDemo.html` through the local skirmish Vite server.
The demo starts paused with four hostile factions, 100 squads each, across a
128�128 map. Each faction has 12�13 squads of each of eight ready Russian troops;
extras alternate between factions so every troop totals 50 squads. The roster is
Clubman, Javelinist, Scout, Shield Warrior, Pikeman, Recurve Archer, Light Cavalry,
and Horse Archer. It mixes Stone and Classical assets for an inspection/load
fixture, independently of normal recruitment age gating. Demo-only definitions
borrow existing age/role profiles; these are not final balance data. Horse archers
combine mounted locomotion with ranged attacks and cannot charge.

All armies frames all 400 squads (up to 3,900 soldiers); Focus battle zooms into
the center. The four 10�10 deployments have three-cell spacing. Only faction 1
is directly controlled; Engage armies issues ordinary attack orders to all four.
Sprite sheets are shared across squads, and mounted clip scales are normalized
before applying fixed rider-calibrated member sizes, preventing double scaling.

Live metrics show requestAnimationFrame FPS and frame p95 over 120 frames, mean
render CPU duration, live soldiers actually drawn, worker tick cost/p95 over 200
steps, and snapshot construction cost. Culled soldiers do not count as drawn.
The simulation runs at 20Hz with a 50ms tick budget. This is local Canvas soldier
rendering plus a simulation worker, not a GPU-instancing or multiplayer capacity
certification. No economy AI is active. `DemoLoadBenchmark.ts` provides a repeatable
30-second Node simulation/component snapshot-clone check without browser rendering.

Engage armies starts an ordinary simulation battle. Select friendly troops, right-click to move/attack,
or use Charge selected. Reset restores the fixture. Scroll zooms, middle drag pans.

Movement showcase opens four close-up panels using the same actor renderer:
infantry, all-rank javelin volleys, a defensive square, and cavalry. Threat front,
left, right and rear change the attack bearing. Surround square adds threats on
all four sides; Auto turns cycles bearings every four seconds. One casualty lowers
each panel's displayed count by one and lets its death/replacement track play.
Pause movement freezes this inspection scene's presentation clock. Reset soldiers
restores twelve foot soldiers or six mounted soldiers and the initial front threat. Back to battle returns to
the paused game. This scene supplies synthetic contacts and attack events for
inspection only; it does not simulate damage or issue game orders.

`FormationEngagement` separates the footprint heading from individual attention.
During ordinary combat the footprint holds its orientation, while soldiers turn
toward their target with varied, bounded response rates and pivot footwork.
Melee attention uses nearby visible opposing soldiers across the frontage rather
than the enemy squad center. Opponents ahead of each slot take priority, with a
nearest-opponent fallback for overlapping lines. A living opponent is retained
through small position noise until another becomes at least 15% nearer or the
opponent disappears. Each threatened square edge uses its own opposing contact.
Opponent poses are frozen at snapshot boundaries to avoid render-order dependence;
this only controls artwork and does not create individual combat targets.
An eight-direction contact edge uses angular hysteresis and a 300ms confirmation
before changing edge. Diagonal attacks activate adjoining edges. A square can
face multiple incoming contacts independently; unthreatened members retain their
outward stance. Ranged troops all face the target without rearranging their ranks.
Two nearby melee reserves take small, staggered support steps using reusable
left/right/straight curves, sampled continuously through interruptions. Casualty
victims and replacement chains follow the threatened edge, not a fixed front row.
Actual soldier positions still use bounded world-space following; an intentional
combat reposition pauses its attack while moving. Short rearward corrections
backstep slowly while retaining enemy-facing; lateral and longer relocations pivot
to walk normally. The choice persists through arrival so a long walk does not flip
into backsteps just before settling. Backsteps reuse the locomotion clip with its
gait played backwards; dedicated backstep artwork can replace this later.
Charges bypass combat footprint holding and return to the existing authoritative
travel/charge heading and wedge choreography. No individual soldier affects orders,
collision, damage, attack eligibility or networking. Authored directional turn and
sidestep artwork remains future art work; pivots currently reuse the running clip.

The experimental footwork controller ramps angular velocity up and brakes it near
the target bearing, rather than starting every pivot at full turn speed. Infantry
combat pivots top out at 60–75 degrees/second; cavalry at 45–60. Reserve steps use
1.6 tiles/second² acceleration (2.4 mounted) and stronger braking, with an arrival
speed envelope. New opposing movement or turn intent first sheds existing momentum.
Travel followers also build speed more gradually; their maximum following speed,
the authoritative squad controller, and straight-line gameplay speeds are unchanged.
Arrival envelopes now apply to travel as well as reserve steps, using the same
member-specific braking rate as the velocity integrator. Travel uses stronger
braking than short combat steps to contain its higher possible speed. The envelope
includes the current integration step and the assigned slot's own velocity.
The experimental path consumes the squad/baked trajectory directly, without a
second lag filter. A final arrival-plane constraint handles oblique approaches
without moving a member through its slot. Regression cases cover abrupt stops,
diagonal infantry/cavalry arrivals, interrupted reserve steps, and 10–120fps sampling.

Each full formation displays 12 individual Russian soldiers, including cavalry.
Cavalry uses six riders with fixed sprite size calibrated against infantry shoulder width. The visual footprint is now twice the original width and
depth (two nominal map cells), scaling soldiers and spacing together for comparison.
It stays fixed in world coordinates across zoom
and casualties. The client samples the existing choreography for formation changes,
front deaths and replacement chains. Infantry can display line, shield wall or
square; cavalry stays in line. Actual charge state triggers wedge and recovery
returns to the regular formation. These choices have no gameplay bonuses yet.

The demo enables the experimental `formationLocomotion` simulation option. Each
squad owns authoritative facing, target facing and speed in its entity state.
`FormationMovementProfile` supplies shared role limits to both the authoritative
squad controller and the client. Squads accelerate at 2 tiles/second² on foot and
3.2 mounted; braking is 3.2 and 4.8 respectively. Travel turns are limited to
40 degrees/second on foot and 30 mounted, below soldiers' pivot capacity. Turns
over 20 degrees brake before pivoting; departure waits until within 12 degrees.
Attacking formations hold their position rather than dragging planted fighters;
explicit movement orders and active charges remain able to move. Combat attention
does not rotate the logical travel heading. Straight-line maximum speed is unchanged.
Arrival speed is bounded by remaining distance and braking.
Collision avoidance still owns position commits, with a forward steering cone;
blocked movement cancels stored momentum. Transports retain their existing movement.
These tuning values are provisional and apply only when this option is enabled.

Charges enter an authoritative preparing phase, brake, turn toward the chosen
destination, and allow at least 4 seconds for forming the wedge. They then run up
under ordinary movement and can commit only while moving and aligned within 12 degrees.
Preparation performs no ordinary attacks. The client follows shared travel facing
while individual attack-facing remains independent.
The formation anchor uses ordinary game interpolation.
Visual following has a small bounded catch-up allowance (10 percent plus 0.15
tiles/second), rather than the old 6/9 tiles/second recovery sprint. Coupled tests
exercise 12 visible soldiers against actual fixed-tick squad acceleration,
180-degree reversal and arrival, with both roles staying within 0.3 tiles of their
assigned slots at 60fps. These are component checks, not a dense-match capacity test.
Individual soldiers now follow moving slots in world space with acceleration,
different response times, and gradual facing changes. Turns temporarily stretch
or compress ranks rather than rigidly rotating all soldiers. Walking phase advances
with each soldier's distance traveled; combat permits small backward/sideways steps
while facing the enemy and ignores tiny slot corrections. Bodies remain where they
fell. Combat followers hold their world position through small slot corrections,
then take a distinct repositioning step after the error exceeds a per-soldier threshold.
Separate start/stop thresholds prevent continuous creeping. Translating soldiers use
walking frames; attack frames require planted feet. The demo walking cycle uses a
provisional stride of 0.7 tiles for infantry and 1.1 for horses, replacing the much
longer 2.5/4-tile strides. These values need visual calibration against authored art.
Individual following remains presentation-only. The new squad turn/braking/charge
rules are authoritative. Shape choices still have no combat bonuses. Routes stay
server-side; no individual soldier or waypoint is replicated. Packed snapshots carry
an optional four-number motion row per changed squad, including identity, and legacy
detail rows remain readable. Motion packets use detail version 2; existing games
continue emitting version 1. Enabling this in multiplayer requires updated clients.
Checkpoints retain motion for deterministic continuation.
The shared local avoidance solver also preserves its reduced stopping budget
when adding friendly spacing preferences, preventing full-speed overshoot near
an arrival or combat stopping distance.

The simulation remains squad based: 1000 aggregate troops at full strength, not
12 authoritative troop entities. The visual count reflects aggregate strength.
The fixture uses the real Skirmish simulation in a local worker, the game renderer,
selection and order commands. AI strategic decisions are disabled; Engage supplies
initial attack orders for both armies. Terrain is a small synthetic grass map.
This is a battle preview, not a full economy/lobby/multiplayer match.

For this visual integration the optional Renderer artwork hook draws individual
actors through Canvas at the normal troop pass, retaining building/effect layering.
The standalone formation laboratory still exercises WebGL instancing. This demo
does not qualify GPU performance: a production GPU integration must preserve these
pass boundaries and be benchmarked independently.

Casualties are queued one at a time while fill tracks settle. Large simultaneous
damage may briefly leave more visual soldiers than the aggregate strength suggests.
Bodies and blood use an independent cosmetic ground pass below all living soldiers.
Bodies shrink to 95% of standing size during the fall and remain for 20 seconds,
then disappear without a fade. Blood grows into a fixed ground stain and remains
for 45 seconds. Both retain the soldier's world position, including when the squad
moves away or is removed; the remaining displayed soldiers fall when a squad dies.
Reset clears all remains. These effects add no simulation entities or network fields.
Javelin volleys replace the legacy five fixed squad emitters with one javelin from
each planted, throwing soldier in every rank. Attack playback uses the individual
sheet's frame-3 release marker and variable frame durations, placing the release
pose on the existing authoritative shot tick. Hand positions use the same sprite
scale, pivot and rotation as the soldier artwork. Launch positions are frozen in
world space for the flight, and javelin size follows world zoom. The first attack
can begin directly at release if it was not predictable before its snapshot arrived.
All living ranged soldiers plant briefly during wind-up/release/follow-through.
They then resume their world-space following without teleporting. Melee attacks
remain limited to front ranks.
This also handles shots released while the aggregate squad is still stopping. Damage,
reload rules and volley networking are unchanged.
The separate formation laboratory retains its existing casualty visualization.

Ground blood uses the transparent four-variant `assets/StoneAgeBloodSplats-v1.png`
atlas generated with the built-in image tool. Variant and rotation stay fixed per
casualty. Its scale remains tied to the previous stain radius, independently of
body shrinkage. Blood stays at full opacity for five seconds, then fades smoothly
until its existing 45-second expiry. Bodies retain their hard 20-second removal.

## Local CPU evidence

The first 600-tick run (30 seconds of game time, 400 squads initially) reached
296 simultaneously fighting squads and ended with 266 squads / 224,084 aggregate
troops. Node simulation step mean was 6.10 ms, p95 10.29 ms, maximum 33.81 ms.
Snapshot construction plus structured clone averaged 4.23 ms (p95 5.16 ms).
The ending JSON snapshot was 606,685 bytes; that is a diagnostic representation,
not wire bandwidth. These are local component measurements, affected by machine
and concurrent workloads. Browser FPS was not measured: browser automation could
not start due to the Windows sandbox setup error. Use All armies to expose the
full soldier draw count and inspect the on-page counters during combat. The page
and movement showcase explicitly share each decoded image through one promise
cache; no per-squad texture creation is performed.

Cavalry registration uses approximate idle shoulder spans of Scout 160px, Light
Cavalry 164px, and Horse Archer 168px against Clubman 340px at its existing 0.24
member scale. These visual reference measurements exclude horse and weapon length;
they are initial art calibration and remain subject to visual approval. The same
whole-actor correction applies to every animation. Six mounted members use a 3�2
line or a 1�2�3 wedge. Column positions fit the two-world-cell width; rank spacing includes the full mount length plus 0.12 world tiles and may exceed the nominal footprint in depth;
member size never shrinks to fit the formation or changes with casualties. Foot
formations retain twelve soldiers, using the Clubman body-size calibration described below. Aggregate strength,
damage, collision, squad count, and network state remain unchanged. The 400-squad
roster now displays up to 3,900 soldiers (250 foot squads, 150 mounted squads).

Cavalry ranks now have a clear 0.12-world-tile gap beyond the approximate 400px
idle mount length. The six-rider line is about 2.2�2.25 cells deep; the 1�2�3
wedge is about 3.3�3.4 cells deep. This deliberate visual extension leaves rider
size, column spacing, authoritative squad footprint, and collider unchanged.

All visible living soldiers share one layer with stable squad/member ID draw
ordering. Cavalry has no special priority, and crossing ground positions never
swaps their overlap order. Animation pivots, sprite size, and facing do not affect
ordering. Individual
sprites are conservatively culled against the viewport after motion updates.
Ground indicators and remains stay below living soldiers; health bars and combat
effects stay above. The battle and maneuver showcase both use this pass. The
performance strip reports sort time separately from total render CPU. This is a
client presentation change; simulation, collision, and replication are unaffected.

## Clubman size audit

`DemoActorCalibration.ts` provides one fixed body-width correction per troop,
measured approximately from the first idle frame and excluding weapon, shield,
and mount bounds. Clubman remains at 0.24 member scale and is the 340px body-span
reference. Javelinist uses 330px (1.03x), Shield Warrior 300px (1.13x), Recurve Archer
260px (1.31x), and Pikeman 220px (1.55x). Existing cavalry references are unchanged.
These are visual registration estimates, not skeletal measurements; differing
armor and pose proportions cannot all be made identical with uniform scaling.
Every troop uses the same correction across all its animations. Authored relative
clip scales are normalized against that troop's idle clip and preserved.

Open `TroopSizeAudit.html` (also linked from the battle toolbar) for animated
before/after cards with a faint Clubman reference at the same world scale. Foot
squads still show twelve soldiers and mounted squads six. Original art sheets and
manifests are unchanged. Tests verify the common audited body span, fixed size
across line/shield/square/wedge layouts, Clubman's original layout and size, and
casualty consistency. Source/type checks do not replace rendered visual approval.
