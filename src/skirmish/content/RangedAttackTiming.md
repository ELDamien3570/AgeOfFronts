# Ranged preparation contract

`ranged-attack-timing.json` owns preparation duration and automatic-fire policy
for every ranged land unit. Values are gameplay content and participate in the
content hash through the resolved attack profiles. No server code reads sprite
metadata. Durations round up to simulation ticks (currently 125 ms). The minimum
500 ms provides a readable preparation window; longer authored movements retain
their calibrated durations. The client stretches the authored pre-release frames
over the committed gameplay interval.

## Authority

An eligible target starts a squad-level `weaponState.rangedAction` containing a
sequence, definition, target kind/identity, start tick and release tick. Preparing
does not consume ammunition, start cooldown, launch a projectile or apply damage.
Every intervening combat tick must retain eligibility. Losing range, the target,
diplomatic permission or firing eligibility cancels preparation. Explicit orders,
target changes, embarking and refitting also interrupt the commitment. A new aim
cannot inherit elapsed preparation. Moving retains existing firing permissions.

At release, the existing combat path checks eligibility and commits the ordinary
weapon cycle. Damage still resolves under the existing direct-hit/projectile
rules; animation completion cannot cause damage. Subsequent preparation fits
before the existing next-ready tick, preserving normal shot-to-shot cadence.
Automatic weapons prepare once per burst, sustain their ordinary cadence, and
prepare afresh after cancellation, target changes or magazine reload. Ground,
aircraft and structure attacks share this commitment path. Fixed gun nests and
ships retain their separate weapon rules.

The state is bounded to one current commitment per squad. A released commitment
remains as presentation history until the next aim. Existing snapshot details and
checkpoints carry the state; validation checks sequence, phase and clock bounds.

## Presentation and recovery

Live combat presentation buffers 500 ms of simulation time. All movement,
preparation and released shot facts use that playhead. A preparation announced in
the next sparse endpoint becomes visible at its own start tick; recorded volleys
and projectiles become visible at their actual release ticks. Future headcounts
and hit points are never pulled forward to fill the gap between publications.
Pause freezes the playhead; terminal matches drain the buffer. Review tick-step
explicitly seeks the newest endpoint and is separate from ordinary pause.

Arbitrary network stalls and unbounded asset delays cannot guarantee complete
playback. If a detailed actor first observes a commitment after its opening frame,
it skips that attack presentation and its new cosmetic release, joining the next
complete preparation instead. Existing launched cosmetic flights may finish.
Gameplay never waits for rendering, visibility, asset decoding or acknowledgement.

The ranged review uses the actual battle simulation and troop renderer. Its
retained snapshots are cloned because the offline simulation exposes borrowed
expansion arrays; worker messages already cross a cloning/encoding boundary.
