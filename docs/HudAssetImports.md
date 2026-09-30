# HUD asset coverage

Reviewed September 30, 2026. This pass changes presentation and prepared artwork only. Research eligibility, costs, AI decisions and combat rules remain domain-owned.

The HUD now resolves locked construction previews separately from available construction commands. A locked command keeps an authored icon and its real construction-cost preview. Existing world entities only reuse artwork from their own or an earlier age. Missing future art does not unlock a building or silently change its definition.

## Imported and connected

- Corrected top-down cities, factories, ports, barracks, ranges and stables across all seven ages.
- Mines, blacksmiths, armory, arms factory, siege workshops, modern vehicle depot, airstrip, oil well/rig and missile silo wherever authored.
- Stone/Bronze/Classical tower artwork from `Art/Terrain/Wall Kit`. Later tower definitions reuse the last authored tier; dedicated later tower art is still absent.
- Modern anti-infantry gun nest and trench from `Art/Terrain/Modern Defenses`. The trench uses the isolated piece in the world and a straight trench as its HUD portrait. This pass does not add connected trench placement.
- Updated fixed MIRV complex icon and prepared idle/launch clips; the map currently displays its idle animation. Building drawing now selects the frame rectangle instead of drawing the full sheet as one icon.
- The MIRV command uses its carrier portrait rather than the ICBM portrait.
- The fixed interceptor hub uses silo art, as requested. Its missile-defence command, targeting and stats are unchanged; the Interceptor Humvee artwork is reserved for the mobile version.
- Existing soldier, ship and support-weapon atlases were refreshed against their authored metadata. All existing registered animation-sheet hashes were current at review time.

Disabled command icons are less heavily dimmed, with reduced saturation. Detailed map icons keep the existing zoom threshold, selected backdrops and layer order.

Map building artwork is now 10% larger, with cities 15% larger, relative to the prior drawn interior. Distant letter markers and HUD portraits retain their sizes. The selection square and click bounds follow the artwork; terrain clearing and placement footprints are unchanged.

Traders now have view-owned movement presentation. Observed position changes select the authored travel loop and rotate the art toward travel; stops select idle and preserve the last heading. Duplicate simulation ticks retain animation phase. The same path handles naval traders with their up-facing ship art. Close-zoom traders use a 44-pixel budget and smooth interpolation, rather than the previous smaller 40-pixel cap. Trade routes, cargo and delivery timing remain domain-owned.

Camera zoom now reaches 96 pixels per terrain cell, twice the previous maximum. Soldier artwork retains the two-cell projection at ordinary zoom but grows to a 55-pixel cap at close zoom, 25% above the previous cap. Its presentation bounds and selection circles follow that size. Distant formation markers keep their existing size and threshold. Collision, combat ranges, buildings and HUD portraits are unchanged.

## Remaining dedicated-art gaps

The Stone Age mine, siege workshop and field ram have no dedicated source art. Locked building previews can show the first authored version, but Stone Age world entities retain their glyphs. The mobile MIRV launcher has no matching art. The fixed missile-defence structure has no dedicated painting and uses the user-approved silo icon. Modern stables art is the existing vehicle-depot presentation. Fortification gates, ruins and later distinct tower tiers are also absent.

Tracked twin-cannon AA, the Humvee interceptor and the separate AA gun-nest art do not imply additional playable definitions. Adding or changing those capabilities belongs to a separate domain task.

## Review and validation

`build/review/hud-assets/index.html` is an isolated fixture using production views and the renderer. Its age and completed-research controls affect fixture snapshots only; it never runs AI or advances a real match. It verifies all seven ages, locked icons, selection portraits and frame rendering.

`scripts/prepareAgeArtwork.py` creates bounded RGBA runtime copies and records source hashes without modifying the originals. `Art/Runtime/hud-asset-validation.json` records the prepared-image checks. No new images were generated in this pass.

`build/review/trader-playback/index.html` renders the six trader ages and trade ships with production drawing, authored playback and adjustable zoom. It is an isolated movement fixture and does not run AI or a trade economy. Focused tests cover headings, interpolation, stops, duplicate ticks, actor removal, frame traversal and close-zoom sizing.
