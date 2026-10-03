# P29 local browser observations - 3 October 2026

Source: final roadmap implementation, runtime `84de069d3cd1af4ee22349705f63106f6f8f0ab039602573b300022d21578b2a`.
Preview: Vite skirmish development server on 127.0.0.1:4187, Windows x64,
Node 24.18.0, Codex in-app Chromium browser, viewport 812 by 929.

These are ordinary UI play observations. They do not enable the opt-in economy,
defense, naval, war-policy or deferred-planning flags. Starting camps used the
normal UI countdown. The UI generated each seed; it was not exposed/captured,
so the scenarios are reproducible as input sequences, not exact seeded replays.
No online join, ten-client run, remote traffic or deployment was performed.

## Observed scenarios

Training Square (The Box, 256 by 256), one regular AI opponent, normal tribes,
solo conquest, 1x game speed and 1x technology speed.

- Stone: observed 5,330 gold and 6,180 reserves at 15 seconds, then 5,418 and
  6,228 at 19 seconds. The research branch counters showed Naval 1/4,
  Warfare 1/4 and Economic 1/4. Mine was disabled and oil was absent.
- Bronze: observed 13,996 gold and 9,224 reserves at 1:08. Branch counters
  showed Naval 1/4, Warfare 1/5, Economic 1/4. Mine and the appropriate
  production buildings were visible; later nodes remained paid research.
- Modern: observed 72,308 gold and 19,120 reserves at 14 seconds, with active
  ordinary combat. The technology card showed Modern Armaments as the starting
  grant and Combined Arms still requiring 120,000 gold / 90 seconds.
  Mine, oil well and oil rig were visible. Naval, Warfare and Economic each
  showed 1/4. No extra current-age technologies were treated as free.
- Modern barracks: normal placement near the selected faction's camp first
  rejected a resource extraction footprint without payment. A legal tile then
  charged 2,800 gold; construction completed normally after resuming.
- Paused Modern recruitment: three Rifle Infantry items charged 9,000 gold,
  3,000 reserves and three equipment kits. One right-click on the queue reduced
  three items to two and refunded exactly 3,000 gold, 1,000 reserves and one
  equipment kit. No browser context menu appeared. Game time and the five-second
  remaining head timer stayed unchanged while paused.
- Selecting completed Barracks #246 showed Modern, 5,792/5,792 health and
  1/1 ready. The building upgrade action was disabled at the final available
  tier. Pressing U reported maximum tier reached, with the treasury unchanged.

## Evidence and limits

![Modern opening](nightly-modern-opening.jpg)
![One-item cancellation](nightly-recruit-cancel.jpg)
![Final-tier building guard](nightly-modern-building.jpg)

The isolated worktree could not load the building marker atlas and displayed
missing artwork in command icons. These were observed and retained; concurrent
Art files in the primary checkout were not copied or edited.

P29 remains partly unaccepted. Positive one-tier building upgrade/payment/timer/
production-pause behavior, damaged/insufficient-funds cases, multiple producer
heads, all remaining age openings, exact tribe age locking, traders and ordinary
online reconnects still need browser acceptance. Unit/integration coverage
does not substitute for those observations. Frame/heap/mature-world capacity
qualification remains open, and this smoke run is not a performance certificate.
