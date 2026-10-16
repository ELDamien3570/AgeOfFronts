# Balance Preview Page

Open `/skirmish/balance-preview.html`. The soldier lab also links to it.

The default **Approved balance** profile uses the live game catalogue. The
October 15 proposal was promoted on October 16: mainline damage/bonuses, 60-RPM
pre-Napoleonic melee (50 for Boyars), armour curves, movement classes, spear
counters and cavalry attacks. Soldier weapons and armour are authored in
`skirmish/plans/soldier-weapons.json`; movement is in `unit-tuning.json`.
Early Modern infantry now uses 87 / 82 / 77% mainline / ranged / anti-cavalry
speed; Modern uses 88 / 83 / 78%. Napoleonic keeps its slower exception.
HP, counts, gold, recruitment, hulls and modern weapon stats are unchanged.
Both labs and ordinary skirmishes now use the same defaults; browser edits and
exports remain local drafts.

Profile revision 2 adds bonus damage against mounted soldiers: heavy cavalry
gets 50% of its baseline melee damage, light cavalry 25%, and ranged cavalry
10% of its ranged damage. Fractional bonuses are retained. These are editable
weapon bonus stats; other target bonuses and charge rules are unchanged.
Unversioned experiment exports are revision 1: their review values validate
against that historical profile, while current previews apply saved numeric
edits over the latest defaults. Revision 3 reads promoted live content. A sparse
historical baseline preserves revision 1 and 2 export validation, including the
old modern speeds; saved numeric edits carry onto current defaults. Re-export
records the current profile revision.

**Live stats / existing drafts** returns to the original namespaces. The approved
experiment uses its own shared numeric-change storage and separate per-page
scenario/inspector caches. Land numeric edits in either lab update the other
open lab through storage events and reset its battle. Formation access and
non-land entity editing remain inspector-only. Invalid/stale inspector caches
are retained; a separate content-version cache receives fresh edits.

Eight contemporary mirror scenarios cover every age. Four mixed-age mirrors
cover Bronze/Classical, Classical/Early Medieval, Early/Late Medieval and Late
Medieval/Napoleonic. Each includes every soldier recipe of its selected ages,
one formation per recipe per side. The artillery/vehicle option includes hull
recipes too. Base/enlarged selection reads current profile capacities. Infantry
and spears start forward, ranged five tiles back, mounted units on flanks, and
artillery twelve tiles back. Both sides mirror the same roster and deployment.
The default fresh experiment opens the Early Medieval contemporary scenario.

### Cavalry comparisons

The shared combat default for melee cavalry is now sustained assault. The lab
also retains an explicitly selected **Rank prototype**, with 25% launch spacing
as its default. This is a lab comparison control; no rank-order button is added
to the game HUD. The future order contract is `attack.cavalryMode: "ranks"`;
ordinary attack orders omit it. Command validation and packed snapshots preserve
that intent, including when attacks continue onto another target.

The arena's rank-launch-spacing control overlaps the ranks more tightly without
speeding up any rider's advance, braking, turn, return or weapon animation.
100% uses the original 10.875-second cycle. Smaller launch gaps reduce it to
9.75 / 8.375 / 6.875 / 6 seconds at 75 / 50 / 25 / 10% spacing. The minimum
cycle waits for the last rank to finish returning before a fresh commitment;
casualty-driven rank promotion cannot replace a rider's unfinished return.
Per-cycle damage, weapon stats, charge behaviour and world movement are unchanged.

Load cavalry test offers 12-versus-12 Early Medieval heavy/light mirrors and a
light-cavalry-versus-spearmen matchup, capped by edited recipe capacities.
Change spacing to reset and compare. The control applies to both sides, saves
with the scenario and exports as `scenario.rankLaunchSpacing`. Selecting ranks
also exports `scenario.cavalryMode: "ranks"`. Older drafts use default assault;
absent spacing defaults to 25%, and custom spacing between 10% and 100% is supported.

Only `BalanceSimulation` supplies the optional battle-world timing resolver.
Committed cycles capture their launch spacing, so domain contact, retaliation,
withdrawal, snapshots and the existing rider renderer read the same wave times.
Ordinary matches omit the resolver and use 25% for an explicit rank order. The
prototype adds no independent soldier simulation or per-frame pathfinding.

The first arena supports land recipes, two configurable rosters, base/enlarged
capacities, custom surviving soldier counts, and authored formations. Each side
supports up to 24 formations. A fixed seed and reset rebuild the same starting
state. The axeman-versus-two-clubmen preset is a simultaneous fight, not three
successive duels or an assertion that the current balance meets that goal.

Watch mode issues ordinary nearest-enemy attack orders for both sides. Selecting
a controlled side stops those automatic orders for that side. Selection,
movement, attack, hold, charge and reform use normal game commands. There is no
economy or strategic AI in the arena. Pause, tick-step, speed, casualties, health
totals and winner feedback support inspection of a repeatable matchup.

The roster editor groups fields under Combat, Defence and Movement. Applying
changes rebuilds the battle. The page owns one draft per recipe: every copy on
both sides and any copies added later use the same edits. Base/enlarged size,
surviving soldier count, starting shape and formation quantity remain scenario
choices. Restore live stats removes that recipe's tuning from every copy.

Applied stats and battle setup autosave in browser storage under
`ageoffronts-balance-preview-premodern-v1` for the experiment, or
`ageoffronts-balance-preview-v1` for live drafts, and reload after refresh. **Save draft** and
**Export JSON** also apply valid pending editor changes. Export produces
`balance-preview-draft.json`; **Import JSON** replaces the current draft and
scenario only after complete validation, then resets the fight. These controls
do not write game content. Experiment numeric edits share the same state as
the Unit & Stats lab; live-mode drafts retain their existing separate storage.

`BalanceDraft` schema version 2 includes recipe IDs/names, sparse `tuning`
changes, original editable `baseline` values with their `baseContentHash`, and
the two rosters plus separation, optional bounded per-entry deployment, and
the selected scenario controls. Controls describe the next preset to load;
saved or customised rosters restore independently of those controls.
Experiment exports also include their versioned profile ID and numeric changes,
plus resolved recipe values for review. Schema-1 imports remain supported.
Removed roster entries do not remove recipe
edits. Original baselines survive re-export after importing or changing game
versions; a status message highlights older baselines. Imports apply explicit
edits over current live defaults. Unknown fields/IDs, duplicates, unsupported
versions, invalid stats, unsupported formations and oversized files are rejected
atomically. Browser storage errors are visible and export remains available.

## Simulation boundary

`BattleLabModel` creates a disposable `BalanceSimulation`. It binds cloned unit
definitions to squad IDs through the optional `BattleWorld.unitDefinition`
resolver. `Expansion.unit()` already delegates to Battle, so movement, melee,
defence, charge and ranged launch commitment read the same local definition.
Overrides bypass the normal owner/recipe cache. The page supplies shared recipe
tuning; programmatic fixtures can still pass independent entry overrides when
no shared recipe override is supplied. The live `UNIT` catalogue is never edited.

The renderer's optional matching resolver keeps ranged indicators consistent.
Art, equipment eligibility and physical formation geometry retain their authored
definition identity. This page edits numerical combat stats, not actor assets or
new weapon capabilities. Ordinary matches omit both optional resolvers.

Local edited catalogues are not ordinary game content or checkpoint state.
BalanceSimulation explicitly rejects checkpoint creation/restoration, preventing
an edited battle from being silently restored as a standard match. New tests can
construct `BattleLabModel` directly with roster/tuning data. Persisted drafts
serialize and validate that setup, never a normal match checkpoint with an
inaccurate content hash.

The real simulation and soldier renderer run in the page's browser thread; the
arena is deliberately bounded and is not a multiplayer or performance benchmark.

## Contact and casualty presentation

The shared renderer and soldier actors use `CombatPresentationTimeline`. Living
counts, formation state, committed strikes and casualties belong to the same
endpoint as the interpolated movement. The clock retains at most four source
snapshots, reuses idle squad objects, and bounds sparse-update catch-up to the
existing 600 ms limit. Pausing or stepping samples the complete latest endpoint.
Preview counters use that same presented state. Gameplay damage and cadence are
unchanged.

Committed melee volleys carry exact carrier positions at impact in the optional
`combatRoots` fact. The packed snapshot keeps these in an optional `volleyRoots`
extension, including transferable-buffer and validation support; old rows remain
readable. A unit destroyed between snapshots can complete its final approach
using those positions before its visual retirement. Ordinary checkpoints retain
the same derived facts as other volleys.

Visible melee casualties are selected against attacked frontage in world space,
including flank/rear attacks and cavalry penetration. The receiving segment is
centered on overlapping footprints, not an arbitrary closest corner. Corpses
freeze the actual final drawn pose, after cavalry continuity, impact offsets and
footwork, and remain fixed in world space as surviving formations move on.
Preview weapon overrides also reach the soldier choreography. Cosmetic soldier
identities still do not become authoritative health or navigation entities.

## Committed cavalry assault

Ordinary Attack commits mounted melee troops to a continuous assault after first
contact. Charge retains the same sustained pattern. The deliberately selected
formation remains the collision body; neither command imposes a wedge. An
automatic travel column unfolds into its selected deployed shape, while a
deliberately selected column stays a column. Individual riders use bounded, cached approach,
attack and exit paths through the certified contact area. Riders brake into a
stationary melee window, turn at low speed, ride out, and build momentum for
another pass. They do not wait for a shared rank cycle.
There are no soldier pathfinding jobs, independent targets, or morale mechanics.
The assault ends when its target dies or the player cancels it with another order.

`ChargeProfile.bonusDurationTicks` is a per-unit stat, initially six seconds for
cavalry with charge. The Unit & Stats card/sheet exposes it automatically in
seconds, and the fight editor exposes **Charge bonus duration (seconds)** in the
Movement tab. Recipe edits are shared by matching units in the local arena and
saved with its draft. Ordinary attacks reserve the bonus. Double right-click
starts a bonus charge on approach, or arms the next committed melee hit during
an existing assault without another impact or formation change. The per-unit
timer begins on that hit, counts down even when entry is held, and cannot be
refreshed by repeated clicks. Withdrawing before an armed hit cancels it without
spending cooldown. The recovered strength captured on approach or arming scales
the damage multiplier; a completely exhausted charge has no bonus window.
Subsequent attacks use the normal weapon cadence and return to ordinary damage
after expiry. The meter and selected-unit text show remaining bonus seconds.
Cooldown recovery requires time outside melee, using the existing per-unit
cooldown stat. `bonusStartTick` records late activation independently of the
assault's movement start; pending and active bonuses survive snapshots and
checkpoint continuation.

`CavalryAssault.cavalryResistance` compares actual HP, effective melee damage and
cadence, surviving manpower, deployed shape, and receiving facing. It uses no
random roll or age shortcut. Current stance weights are 1 for frontal mass,
1.65 for an ordered frontal line, 3.2 for frontal anti-cavalry, 4 for square,
0.55 for a flank, 0.3 for the rear, and 0.45 while reforming/in column. These are
initial balance calibration. A held line admits no penetration; terrain and wall
certification can also deny entry. Cosmetic paths stay outside a holding edge.
Contact geometry is refreshed on committed attacks; each rider freezes a pass
against that frame and replans on completion or a material contact change.

Move cancels future attack damage and enters explicit withdrawal. Exposed rank
riders retain their return presentation and remain vulnerable, including existing
rear-exposure modifiers as they turn. The collision body translates out before
pivoting. Withdrawal obeys the movement order to its destination rather than
being converted back into an attack at the next close encounter.

Assault timing, resolved resistance, certified geometry and withdrawal retention
are bounded squad state in the existing cavalry-engagement payload. Packed full
and delta snapshots, checkpoint continuation, and malformed-state validation use
the same authority; rendering never starts or extends the damage timer.

### Charge input

The preview uses the game's `OrderGesture`: a right click immediately sends the
ordinary order; a second nearby right click within 350 ms on the same selection
upgrades it to Charge. Shift-right-click remains a queued ordinary order. The
Charge bonus button followed by a right click is also available. Both paths
filter the selection through the normal charge eligibility check, so other
selected unit types do not reject an otherwise valid cavalry charge. Feedback
reports the number of charging formations or the rejection reason. Selection,
control-side changes, battle resets and Escape clear the pending gesture.

### Rider motion

`CavalryAssaultMotion` owns only current visible rider paths and samples them
from the shared simulation presentation clock. Plans are independent of render
rate, freeze when paused, keep survivor identity through casualties, and are
released on culling, detail changes, death, withdrawal or match reset.

Cubic paths are sampled by arc length. A forward acceleration pass and backward
braking pass cap the speed profile; curvature also caps lateral acceleration
and moving yaw rate. C1 inverse arc length avoids velocity discontinuities at
lookup-table boundaries. Joined curves account for one-sided curvature limits.
Stopped turns have a separate bounded yaw profile. `ASSAULT_PACE` speeds the
original motion profile up by 25%, including turns, while preserving its routes,
braking distances and turn radii: speed and yaw scale by 1.25, acceleration and
braking by 1.25 squared. Contact pauses and launch delays retain their timing.
The resulting maximum speed is 1.3125 tiles/s, with lower individual caps.
These are visual calibration values; unit speed stats and damage are unchanged.

Independent deterministic streams choose launch delay, strike lane/depth,
contact duration, peel direction, open cutback versus rounded retreat, speed and
next-pass route. They are keyed by squad, stable rider and pass; they do not
share a lane/phase seed or a common orbit. Attack clips play during stationary
contact only while an authoritative committed melee event remains active.
Casualties still freeze the actual final drawn pose. No soldier selects targets,
requests navigation, or creates damage from reaching an animation waypoint.
