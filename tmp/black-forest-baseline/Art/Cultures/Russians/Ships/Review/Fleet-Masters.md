# Russian fleet masters for the eight-age technology plan

The saved `russians-rework` civilization in `skirmish/plans/technology-plan.json` is the roster source. Stone, Bronze and Classical retain their nine approved animated vessels. Seventeen approved, animated vessels complete the roles in the remaining five ages.

| Age | Warship | Transport | Trade | Additional vessel |
| --- | --- | --- | --- | --- |
| Early Medieval | Rus fighting longboat | Passenger longboat | Fur-laden river merchant | — |
| Late Medieval | Wooden gunship | Passenger sailing ship | Cargo sailing ship | — |
| Napoleonic | Ship of the line | Troop transport | Merchantman | — |
| Early Modern | Soviet destroyer | Troop transport | Powered freighter | Diesel submarine |
| Modern | Guided-missile frigate | Troop landing ship | Container ship | Nuclear submarine |

Research upgrades reuse their age's vessel master. Advanced Submarine Systems describes engineering research; Nuclear Submarines provides the Modern submarine unlock. Nuclear propulsion does not imply a ballistic missile carrier. `Tech-Tree-Fleet-Coverage.json` records each master and its exact unlock ID, plus the source plan checksum.

The built-in imagegen tool produced each vessel separately. `../Fleet-Generation-Requests.json` contains the full prompt set and generated file locations. Each age/role folder retains the unchanged generated original, a square registered master, its prompt/provenance manifest and 48/64/128 pixel exports. Registration only fits alpha bounds uniformly onto a 1254 x 1254 transparent canvas, with no aspect stretch or repainting. Designs are era-inspired game silhouettes, not named-ship reconstructions. Historical silhouette context included the [Royal Museums Greenwich Russian sailing-warship collection](https://www.rmg.co.uk/collections/objects/rmgc-object-66742) and [Soviet naval reference overview](https://naval-encyclopedia.com/ww2/soviet-navy.php).

The boat review now includes submarine cards in ages containing submarine assets, and shows no base comparison where no base submarine art exists. Prior catalog entries and all 784 tracked previous ship, trader and aircraft images were preserved. `Fleet-Master-Validation.json` records source/guard/roster checks; JavaScript syntax checks and HTTP availability passed. Contact sheets were inspected locally; live browser visual validation was unavailable.

The user approved all 17 masters and authorized animation with “okay animate them all.” All 17 now have Idle and Sailing; the five warships and two submarines also have Attack. This adds 41 primary clips / 410 frames, plus opposite-side broadside variants for the Late Medieval and Napoleonic warships. The complete catalog contains 26 vessels and 62 primary clips.

`../fleet-rig-authoring.json` contains the editable oar pivots, hull protection, motion amplitudes and weapon emitters. Thirty-four exterior painted oars rotate as rigid pieces; complete blade pixels are assigned to the nearest shaft, eliminating leftover fragments from narrow masks. Protected deck paint, cargo and fixed equipment stay attached to the rigid hull. Idle and Sailing loop at 8/12 fps. Attack is a ten-frame one-shot at 10 fps; the review's repeat control can replay it. Water, vessel and weapon passes remain separate. Cannon, missile and torpedo effects are presentation-only.

Rebuild the new fleet from the repository root with `python 'Art/Cultures/Russians/Ships/animate-fleet.py'`. The exporter verifies source hashes, original paint reconstruction, sheet dimensions, complete frames, clipping guards, pass composition and loop seams. `Fleet-Animation-Validation.json` records checks for all 410 primary frames and preservation of 876 prior images. The review server serves all new metadata and sheets; pose contact sheets were inspected locally. Live browser visual verification remains unavailable.

No gameplay content, technology plan, match renderer, base artwork or approved early-age animations changed. `register-fleet-masters.py` remains the one-time registration script and refuses to overwrite existing versioned masters or catalog roles.

Water alignment revision: all 17 vessels from Early Medieval onward use individually registered bow and stern waterline anchors in `fleet-rig-authoring.json`. The water pass follows the exact hull yaw and translation, instead of using whole-sprite bounds that include oars, yards and decoration. `python 'Art/Cultures/Russians/Ships/animate-fleet.py' --water-only` rebuilds only Sailing water/composite sheets and previews. `Water-Alignment-Validation.json` records 170 water frames, hull-anchor checks and preservation of 1,093 other images, including Idle, Attack, vessel passes, base art and Stone/Bronze/Classical artwork. Corrected age previews use the `-Sailing-Water-Aligned.gif` suffix; original overview GIFs are retained.
