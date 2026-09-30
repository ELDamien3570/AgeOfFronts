# Age progression and compact HUD

Implemented September 30, 2026. This describes the playable local `ages-v1` ruleset. The OpenFront network game is a separate integration; these systems currently run in the skirmish worker.

## Content and ownership

The default culture resolves 84 named technologies into seven ages and three independent research queues. Each tree has a foundation, two branches and a final node. Completing two current-age trees unlocks a paid, timed advancement; an unfinished third tree remains researchable later. Research grants eligibility rather than converting existing armies.

`src/skirmish/content` owns technology, unit, vessel, building and culture definitions. `src/skirmish/domain` owns research, supplies, production, combat, fortifications, trade and diplomacy. `Skirmish` remains the authoritative aggregate. Views read snapshot-based ViewModels and submit commands; they do not spend resources or simulate combat. The snapshot includes a resolved content compatibility hash, rich unit jobs and bounded world events. Authentication remains a future transport responsibility.

Existing `sandbox-v1` fixtures retain their old rules. The normal browser match starts `ages-v1` with three infantry squads, 3,000 gold, Flint Weapons and Settlements, and no buildings.

## Playable systems

- Seven infantry, ranged and mounted/vehicle tiers; distinct military vessel definitions and civilian traders. Mounted recruitment requires horses; tanks use equipment, steel and oil.
- Raw deposits, research-gated extraction, refining, manufactured equipment and finite payload inventories. Producer recipes repeat while inputs remain available.
- Explicit paid ten-second land and naval refits, validated for the whole selected group. Identity and casualties are preserved, experience resets, and refitting units cannot move.
- Separate melee/ranged percentage armour, penetration, additive target-class bonuses and separate bonus resistance. Damage credit uses effective damage, including overkill apportionment; promotions have seven levels.
- Early mounted charges, ranged volleys, siege and field artillery, swept projectiles, independent blast radii and single-impact resolution. Intact walls block surface shell splash.
- Towers with same-age cardinal links, integrity, explicit gates, timed repairs and navigation/capture blocking. Gun nests, passable infantry-cover trenches, aircraft-only anti-air and separate strategic interception.
- Fighters/bombers, sorties with finite fuel, ICBMs, hydrogen bombs, mobile/complex MIRVs, deployment checks and finite launcher cooldowns. MIRVs divide their damage among four children without a second parent blast.
- Factory goods, automatically dispatched land/sea traders, finite multi-stop shipments, domestic/foreign/allied payment, military capture and prize return. Cargo value is fixed when loaded; returned or lost cargo pays no gold. Factories and ports do not generate passive gold.
- Timed offers, alliances, mutual renewal, betrayal, allied targeting and gate/capture permissions. Solo and allied victory modes use conquest rather than reaching Modern.
- Cosmetic cardinal roads generated along valid land trade routes, with authored age atlases. They give no movement bonus and have a 20,000-cell presentation budget independent of navigation.

## Controls and presentation

Gold, reserve troops and folding material/equipment categories occupy the top strip. The compact bottom dock separates economy, military buildings, troops, ships, air/strategic and orders, with independently scrolling categories and hover/focus descriptions.

| Key | Action |
| --- | --- |
| Q / W / E | Infantry / ranged / mounted recruitment |
| A / S / D | City / factory / port placement |
| F / G / H | Barracks / archery range / stable placement |
| T / B | Transport / warship recruitment |
| R / X | Replenish / hold |
| Y / I / U | Technology / production management / selected-group refit |
| Shift + number / Ctrl + number | Add to / replace control group |
| Number | Recall control group |

Auto tier defaults on and covers troops and military ships. It selects the newest unlocked, affordable definition with a completed compatible producer, subject to the selected age ceiling. With Auto tier off, an explicit age selects that exact tier and displays its availability instead of silently substituting an older unit. Recruitment selects a producer near the army, or the camp if nothing is selected.

Aircraft recruitment chooses the nearest eligible airfield. Sorties use selected ready aircraft. Strategic launch prefers a selected compatible launcher; otherwise it selects the nearest ready compatible one. Production and wall controls use pages so high building counts do not remove access to later entities.

Click a rival's territory, unit, building or Factions entry to open Diplomacy and see its **current age**. The bottom-right World events feed records age completion, regular-faction conquest and diplomatic actions involving the player. Tribal wars are omitted. Diplomatic entries open the relevant faction card. Domain history is bounded to 80 events; the visible feed retains 40 entries.

Available authored animations are prepared into lazy-loaded 128-pixel runtime atlases without modifying their sources. Missing Stone siege, some modern support, later fortification and gate art remain provisional. `scripts/prepareAgeArtwork.py` records source hashes and can rebuild the prepared library.

## Explicit prototype defaults

These are implementation defaults for playtesting, not a claim of final balance:

- First age advancement remains the agreed 50,000 gold / 40 seconds. Subsequent fees and timers follow the design catalogue. No AI research-speed or cost discount is applied.
- Ordinary building prices scale by age. Opening income is 20 gold/second plus territory; cities add reserves. Factory goods and finite delivery payments provide the intended developing economy.
- Three seconds without combat, owned ground and a manual order are required for reserve replenishment. Research does not heal or refit units.
- Towers link to at most two nearest completed same-owner/same-age towers within twelve cells. Links cost 25 gold per cell multiplied by age index plus one. Tower construction blocks occupied cells immediately; placing a tower through units is rejected. Ordinary walls block friendlies too; explicit gates admit the owner and allies. Towers have no automatic weapon.
- Trenches supply cover to up to six nearby infantry formations. Gun nests use an omnidirectional prototype attack. Aircraft capacity is six per airfield and 32 per faction, with a 60-second fuel cycle. Launchers have a 60-second cooldown, strategic flight lasts 36 seconds, and mobile launchers need five stationary seconds to deploy.
- Domestic trade does not require diplomacy. An orphaned empty trader retires; a shipment that exhausts its stops after losing its source records leftover cargo as lost rather than remaining open forever.

## Validation and practical limits

The integration suite covers content validation, tree prerequisites, age advancement, resource spending, ownership changes, supply/trade conservation, refit atomicity, damage bonuses, promotion credit, walls, projectiles, MIRVs, diplomacy, victory, snapshots, faction-age inspection and spatial faction filtering. Browser checks cover the compact dock, narrower technology panel, a research purchase, AI inspection, a diplomatic response in the feed, construction and hotkey recruitment.

The full seven-age one-hour pacing target is **not yet balanced or validated**. Research prices and match survival need a representative economy/war run; the reported AI progression complaint is queued separately from the HUD integration.

`build/review/age-progression/capacity.json` records an intentionally demanding headless 1000×500 fixture with 20 factions, 4,000 squads, 1,280 ships and 1,000 stacked cities. Shared building tile queries and faction-filtered combat buckets substantially improve the new ruleset. The combined-cap fixture still exceeds the 50 ms fixed-step budget on this machine. These short worker measurements do not establish 30 FPS, sustained Modern battle performance, real heightmap/forest performance or multiplayer readiness. Unlimited buildings is a gameplay rule, not unlimited computational capacity.

The corresponding-source download must be refreshed with `npm run source:skirmish` before publishing a new build.
