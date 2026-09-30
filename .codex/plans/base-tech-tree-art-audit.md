# Art evidence for the complete base tree

Army-plan addition: the existing Formation Icons kit supplies unit-role markers and separate promotion insignias. Bronze B-W5 Armies needs a distinct group-selection symbol; it is a planned asset, not an additional military unit or a use for promotion stars. See [army UI and source integration](<optimization and ai improvement/armies-formations-and-squad-sizes.md>). This addition does not claim a fresh visual review of all art folders.

Inventory and visual review, September 30, 2026. All nine root categories under `Art` and their recursively discovered subfolders were inspected. Review covered static masters, corrected building art, animation metadata, manifests, authoring scripts, and visual contact sheets of the units/buildings/ships plus terrain/road/effect samples. This is content evidence, not a fresh animation-quality certification or engine-integration test. Art production elsewhere in the workspace is ongoing; this is a dated snapshot.

The resulting content placement is in [the complete base tree](base-tech-tree.md). Original art, scripts, manifests and validation reports were not changed by this planning pass.

## Every root category and its disposition

| Folder                                         | Verified content                                                                                                                                                                        | Base-tree disposition                                                                                                                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Aircraft Icons](<../../Art/Aircraft Icons>)   | Modern WWII-labelled fighter and four-engine bomber static PNGs, generation metadata                                                                                                    | M-W3 Military Aviation; aircraft animations still needed.                                                                                                                                             |
| [Bomb Icons](<../../Art/Bomb Icons>)           | Conventional aerial bomb, ICBM and hydrogen-bomb static art; five explosion/impact animation families, source atlases and review/validation data                                        | Conventional payload at M-W3; ICBM/hydrogen capabilities at M-W4. Impact families are presentation, not five additional technologies.                                                                 |
| [Building Icons](<../../Art/Building Icons>)   | Seven-age common structures, corrected top-down versions, six-age mines/siege facilities, four-age blacksmiths, Early Modern Armory, Modern Arms Factory/airstrip/oil well/oil rig/silo | Map all construction/producer families to the owning nodes below. `_prepared`, previews and older orientations are not additional unlocks.                                                            |
| [Formation Icons](<../../Art/Formation Icons>) | Seven marker families in PNG/SVG plus seven-level star insignias and review images                                                                                                      | Combat-line markers and independent promotion overlays. Ranged-cavalry marker does not prove an extra seven-age horse-archer unit line.                                                               |
| [Ship Icons](<../../Art/Ship Icons>)           | Transport, Warships and Trade; all seven ages, normalized sources, sailing/idle metadata, warship attack sheets and rig layers                                                          | Naval unit/commerce development through every age. Treat Trade as a civilian definition, distinct from military Transport.                                                                            |
| [Soldier Icons](<../../Art/Soldier Icons>)     | Melee/Ranged/Cavalry static sources for all seven ages; per-line Idle/Running/Attack metadata through Early Modern                                                                      | Warfare frontline/ranged/mobile definitions. Modern has static unit art but no matching animation metadata in this snapshot.                                                                          |
| [Terrain](../../Art/Terrain)                   | Painted accent atlas, twelve Earth-family libraries, six-age trade roads and a three-tier cardinal wall/tower kit                                                                       | Environment art stays outside counted research. Trade-road tiers map to Economic logistics; separate wall/tower tiers map to Warfare fortifications.                                                  |
| [Trader Icons](<../../Art/Trader Icons>)       | Six animated overland definitions from Bronze handcart to Modern truck, editable regions/masks, twelve clips and review data                                                            | Economic trader progression. No Stone land trader source/animation is present.                                                                                                                        |
| [Weapon Icons](<../../Art/Weapon Icons>)       | Newly delivered pack: twelve field-artillery/siege definitions, each with Icon and Idle/Movement/Attack metadata, source atlases, manifests and validation reports                      | Bundle support units into ranged/Combined Arms nodes and dedicated siege into final Warfare nodes. Pack status is animation-proposals; finished military inventory-item icons are still separate art. |

## Coverage across ages

S/B/C/EMed/LMed/EMod/M mean Stone/Bronze/Classical/Early Medieval/Late Medieval/Early Modern/Modern. A means static artwork plus animation metadata; P means static/corrected PNG; dash means missing. U means announced art scope not yet verified; N/A means no new tier of that family is required. Metadata presence is not proof that every animation looks correct.

| Family                                   | S   | B   | C   | EMed | LMed | EMod | M   |
| ---------------------------------------- | --- | --- | --- | ---- | ---- | ---- | --- |
| Frontline / Melee folder                 | A   | A   | A   | A    | A    | A    | P   |
| Ranged folder                            | A   | A   | A   | A    | A    | A    | P   |
| Mobile / Cavalry folder                  | A   | A   | A   | A    | A    | A    | P   |
| Transport ship                           | A   | A   | A   | A    | A    | A    | A   |
| Warship                                  | A   | A   | A   | A    | A    | A    | A   |
| Trade ship                               | A   | A   | A   | A    | A    | A    | A   |
| City, Factory, Port                      | P   | P   | P   | P    | P    | P    | P   |
| Barracks, Archery Range, Stables         | P   | P   | P   | P    | P    | P    | P   |
| Mine                                     | -   | P   | P   | P    | P    | P    | P   |
| Siege facility                           | -   | P   | P   | P    | P    | P    | P   |
| Blacksmith                               | -   | P   | P   | P    | P    | -    | -   |
| Armory                                   | -   | -   | -   | -    | -    | P    | -   |
| Arms Factory                             | -   | -   | -   | -    | -    | -    | P   |
| Land trader                              | -   | A   | A   | A    | A    | A    | A   |
| Trade roads                              | -   | P   | P   | P    | P    | P    | P   |
| Military Airstrip, Fighter, Bomber       | -   | -   | -   | -    | -    | -    | P   |
| Oil Well, Oil Rig, Missile Silo          | -   | -   | -   | -    | -    | -    | P   |
| Conventional bomb, ICBM, hydrogen bomb   | -   | -   | -   | -    | -    | -    | P   |
| Tower/wall sprites for the new age tier  | P   | P   | P   | -    | -    | -    | N/A |
| Gates, breach and construction states    | -   | -   | -   | -    | -    | -    | N/A |
| Gun nests and trenches                   | N/A | N/A | N/A | N/A  | N/A  | N/A  | U   |
| Anti-air and fixed/mobile MIRV launchers | N/A | N/A | N/A | N/A  | N/A  | N/A  | U   |
| Moving siege-engine sprites              | -   | A   | A   | A    | A    | A    | A   |

The Building Icons Mine and Siege PNGs describe facilities, not extractable deposits or moving siege units. The refreshed Weapon Icons pack independently supplies the moving siege/support definitions below. Walls depicted around a city/barracks are baked decoration, not player-placed barrier segments or gates.

## Wall kit added during review

The [wall manifest](<../../Art/Terrain/Wall Kit/Wall_Kit_Manifest.json>) and [authoring guide](<../../Art/Terrain/Wall Kit/README.md>) contain three tiers, 48 cardinal wall pieces and three independent towers. The progression preview was visually inspected. The user confirmed retaining the manifest's Stone/Bronze/Classical age mapping.

| Wall-kit directory                                                  | Confirmed age | Existing technology        | Tower                 |
| ------------------------------------------------------------------- | ------------- | -------------------------- | --------------------- |
| [Palisades](<../../Art/Terrain/Wall Kit/Palisades>)                 | Stone         | S-W4 Field Engineering     | Timber watch platform |
| [StoneWalls](<../../Art/Terrain/Wall Kit/StoneWalls>)               | Bronze        | B-W4 Fortified Settlements | Round stone tower     |
| [MassiveStoneWalls](<../../Art/Terrain/Wall Kit/MassiveStoneWalls>) | Classical     | C-W4 Masonry Engineering   | Square bastion        |

Each tier has sixteen mask pieces, Wall_Atlas.png, Wall_Atlas_Padded.png, Tower.png and tiles.json. Source sprites are 256px, share a centre pivot at (128,128), and use N/E/S/W bits 1/2/4/8. Wall art is drawn before the independent tower at the same cell position and scale. Corner/junction slots do not themselves create paid gameplay towers.

The [supplied validation report](<../../Art/Terrain/Wall Kit/Wall_Kit_Validation.json>) reports 48 pieces, three towers, 1,536 compatible edge pairs and twelve corner fits. This planning pass read that report; it did not rerun it or verify game import/collision. The guide says cross-tier transitions are not included. Gates, opening/breach/construction states and separate Early Medieval/Late Medieval/Early Modern wall tiers are not verified.

Early Medieval still grants improved fortifications at EMed-W4. Modern grants gun nests/trenches rather than a new wall tier, while older walls remain usable. Modern anti-air and fixed/mobile MIRV additions are confirmed scope; matching new art was not located in the inspected filenames, so their readiness remains unverified.

## Exact unit identities observed

Land names through Early Modern are taken from `animations.json`; Modern roles are inferred from the inspected static art and remain authored definition names to confirm during balancing.

| Age            | Frontline                 | Ranged                        | Mobile                                   |
| -------------- | ------------------------- | ----------------------------- | ---------------------------------------- |
| Stone          | Clubmen                   | Javelinists                   | Mounted spearmen                         |
| Bronze         | Bronze swordsmen          | Bronze archers                | Four two-horse chariots in the animation |
| Classical      | Sword-and-shield infantry | Classical archers             | Mounted swordsmen                        |
| Early Medieval | Sword-and-shield infantry | Bowmen                        | Mounted spearmen                         |
| Late Medieval  | Plate swordsmen           | Crossbowmen                   | Lance knights                            |
| Early Modern   | Short-gun infantry        | Musketeers                    | Mounted pistoliers                       |
| Modern         | Rifle infantry            | Precision shooters / marksmen | Tanks                                    |

This corrects the earlier generic Bronze mounted-rider and later melee-DPS sketch. Chariots have a different footprint; firearms need ranged attack profiles even in the Melee folder. Art crew counts do not define costs, troop strength, hitboxes, or promotion XP.

Ship rigs explicitly contain cannon-recoil/gun-port layers for Late Medieval and Early Modern. The Late Medieval cannon art prompted the approved placement of basic naval gunpowder in LMed-E2 and naval gunnery in LMed-N3, before Early Modern handheld infantry firearms.

The seven-level insignias use one to five green stars at levels 1-5, a five-star gold ring at level 6, and a purple/gold five-star ring at level 7. Level 7 does not mean seven drawn stars. Their age-neutral placement remains separate from faction tint and unit age.

## Field-artillery and siege pack added during review

The refreshed [Weapon manifest](<../../Art/Weapon Icons/Weapon-Manifest.json>) lists twelve definitions and labels their status `animation-proposals`. Their static Icon PNGs were visually reviewed, and Idle/Movement/Attack metadata exists for each. [The supplied validation report](<../../Art/Weapon Icons/Weapons-Validation.json>) was located; this planning pass did not rerun animation quality checks.

| Existing asset directory under `Art/Weapon Icons` | Age            | Base node                                                       |
| ------------------------------------------------- | -------------- | --------------------------------------------------------------- |
| `Siege Weapons/BatteringRam_BronzeAge`            | Bronze         | B-W4 Fortified Settlements                                      |
| `Siege Weapons/SiegeTower_BronzeAge`              | Bronze         | B-W4 Fortified Settlements; assault/bridge role still to author |
| `Field Artillery/Mangonel_ClassicalAge`           | Classical      | C-W2 Ranged Warfare                                             |
| `Siege Weapons/Onager_ClassicalAge`               | Classical      | C-W4 Masonry Engineering                                        |
| `Field Artillery/Ballista_EarlyMedieval`          | Early Medieval | EMed-W2 Bow and Bolt Warfare                                    |
| `Siege Weapons/Trebuchet_EarlyMedieval`           | Early Medieval | EMed-W4 Trebuchet Engineering                                   |
| `Field Artillery/OrganGun_LateMedieval`           | Late Medieval  | LMed-W2 Crossbows and Field Guns                                |
| `Siege Weapons/Bombard_LateMedieval`              | Late Medieval  | LMed-W4 Siege Ordnance                                          |
| `Field Artillery/NapoleonicCannon_EarlyModern`    | Early Modern   | EMod-W2 Musket and Artillery Drill                              |
| `Siege Weapons/EarlyHowitzer_EarlyModern`         | Early Modern   | EMod-W4 Howitzer Engineering                                    |
| `Field Artillery/BrowningMachineGunner_Modern`    | Modern         | M-W2 Combined Arms                                              |
| `Siege Weapons/ModernHowitzer_Modern`             | Modern         | M-W2 Combined Arms                                              |

Each directory supplies `Icon.png` and `animations.json`. These are distinct from blacksmith-made inventory equipment tokens. Preserve native facing in the presentation catalog: this pack faces screen-up, while soldier/trader animations face screen-down. Crew art does not determine troop counts, cooldowns, hitboxes or damage events.

The `_previous` folder preserves an earlier Modern Howitzer version. It is archival source evidence, not a thirteenth live unit definition or another research unlock; use the manifest's current twelve definitions.

The authored age tags place trebuchets in Early Medieval and gunpowder field/siege units in Late Medieval. The base catalogue has been revised accordingly; handheld infantry firearms remain Early Modern. This is an art-aligned game progression, not a claim about precise historical dates.

## Canonical art families and node ownership

Paths are relative to the repository. `{Age}` is one of the exact art tokens StoneAge, BronzeAge, ClassicalAge, EarlyMedieval, LateMedieval, EarlyModern, Modern. Resolve authored asset references explicitly; these patterns document existing naming, not runtime discovery rules.

| Content                       | Existing source pattern / exception                                                                                                                       | Owning node or role                                                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontline units               | `Art/Soldier Icons/Melee/Melee_{Age}.png`; animations under `Melee/{Age}/animations.json` through EarlyModern                                             | Warfare foundation in each age                                                                                                                                        |
| Ranged units                  | `Ranged/Range_StoneAge.png`, `Range_BronzeAge.png`, `Range_ClassicalAge.png`; then `Ranged_{Age}.png`                                                     | Warfare branch 2; Modern marksmen are bundled into M-W2                                                                                                               |
| Mobile units                  | `Art/Soldier Icons/Cavalry/Cav_{Age}.png`; animations under `Cavalry/{Age}` through EarlyModern                                                           | Warfare branch 3; Modern tanks are bundled into M-W2                                                                                                                  |
| Common structures             | `Art/Building Icons/{Family}/Top-Down-Correction/{Prefix}_{Age}.png`                                                                                      | City/commercial tiers in Economic; ports in Naval; recruitment facilities in Warfare                                                                                  |
| Stone factory exception       | `Art/Building Icons/Factory/Top-Down-Correction/Factor_StoneAge.png`                                                                                      | S-E2 Craft Workshops; display Workshop despite legacy Factory filename                                                                                                |
| Mines                         | `Art/Building Icons/Mine/Top-Down-Correction/Mine_{Age}.png`, Bronze onward                                                                               | Economic extraction/operating foundation; Stone requires new art                                                                                                      |
| Blacksmiths                   | `Art/Building Icons/Blacksmith/Top-Down-Correction/Blacksmith_{Age}.png`, Bronze through LateMedieval                                                     | Warfare foundations B-W1, C-W1, EMed-W1, LMed-W1                                                                                                                      |
| Siege facilities              | `Art/Building Icons/Siege/Top-Down-Correction/Siege_{Age}.png`, Bronze onward                                                                             | Warfare ranged branches also grant the field-artillery producer capability from Classical; final nodes grant dedicated siege through Early Modern; M-W2 Combined Arms |
| Armory                        | `Art/Building Icons/Armory/Top-Down-Correction/Armory_EarlyModern.png`                                                                                    | EMod-W1 Firearms; the manifest describes a firearm producer                                                                                                           |
| Arms Factory                  | `Art/Building Icons/Arms Factory/Top-Down-Correction/ArmsFactory_Modern.png`                                                                              | M-W1 Modern Armaments; further patterns granted by M-W2/3/4                                                                                                           |
| Modern Stables                | `Art/Building Icons/Stables/Top-Down-Correction/Stables_Modern.png`                                                                                       | Proposed vehicle depot at M-W2; retain old horse stables for breeding                                                                                                 |
| Military transports           | `Art/Ship Icons/Transport/Transport_{Age}.png` plus per-age metadata                                                                                      | S-N2; B-N1; branch N2 in the remaining ages                                                                                                                           |
| Warships                      | `Art/Ship Icons/Warships/Warship_{Age}.png` plus per-age attack metadata                                                                                  | Naval branch N3 in every age                                                                                                                                          |
| Trade ships                   | `Art/Ship Icons/Trade/{Age}/Source_Transparent.png` plus metadata; Stone master is also `Trade/generated/Trade_StoneAge.png`                              | S-N2, B-N2, then each N2                                                                                                                                              |
| Land traders                  | `Art/Trader Icons/{Age}/Source_Transparent.png` and `animations.json`, Bronze onward                                                                      | S-E2 missing; B-E2, C-E3, EMed-E3, LMed-E3, EMod-E3, M-E3                                                                                                             |
| Roads                         | `Art/Terrain/Trade Roads/{Age}/Road_Atlas.png`, padded atlas and `tiles.json`, Bronze onward                                                              | B-E3, C-E3, EMed-E3, LMed-E3, EMod-E3, M-E3                                                                                                                           |
| Modern oil                    | `Oil Well/Top-Down-Correction/OilWell_Modern.png`; `Oil Rig/Top-Down-Correction/OilRig_Modern.png`, under Building Icons                                  | M-E1; onshore-well role is a placement proposal under the same unlock                                                                                                 |
| Airfield                      | `Art/Building Icons/Military Airstrip/Top-Down-Correction/MilitaryAirstrip_Modern.png`                                                                    | M-W3                                                                                                                                                                  |
| Aircraft                      | `Art/Aircraft Icons/Fighter_WWII_TopDown.png`, `Bomber_WWII_TopDown.png`                                                                                  | M-W3; no helicopter/jet asset is implied                                                                                                                              |
| Conventional payload          | `Art/Bomb Icons/AerialBomb_WWII_TopDown.png`                                                                                                              | M-W3                                                                                                                                                                  |
| Strategic payloads / launcher | `Art/Bomb Icons/ICBM_Modern_TopDown.png`, `HydrogenBomb_Modern_TopDown.png`; `Art/Building Icons/Missile Silo/Top-Down-Correction/MissileSilo_Modern.png` | M-W4                                                                                                                                                                  |
| Impact visuals                | `Art/Bomb Icons/Explosions/{AerialBomb,ArtilleryImpact,GunshipImpact,ICBM,HydrogenBomb}/animations.json`                                                  | Authored attack-event presentation; no extra research                                                                                                                 |
| Formations and levels         | `Art/Formation Icons/{png,svg}` and `Rank Insignias/{png,svg}`                                                                                            | Class markers and promotion level, independent of empire age                                                                                                          |
| Wall/tower art                | Art/Terrain/Wall Kit/{Palisades,StoneWalls,MassiveStoneWalls}/{tiles.json,Wall_Atlas.png,Wall_Atlas_Padded.png,Tower.png}                                 | S-W4, B-W4, C-W4 respectively; older entities retained in Modern                                                                                                      |
| Modern new defences/support   | Gun nests, trenches, anti-air vehicle and fixed/mobile MIRV launcher art announced; exact authored paths not verified                                     | M-W2 for positions/anti-air, M-W4 for MIRV launchers; missile defence separate                                                                                        |
| Earth accents                 | Twelve folders under `Art/Terrain/Earth`; named entries in `manifest.json`                                                                                | Environment presentation; no resource deposit, collision or research inferred from pixels                                                                             |

## Manifest evidence and limitations

- [Ship animation manifest](<../../Art/Ship Icons/Ship_Animation_Manifest.json>) lists 21 vessel definitions and 49 clips across seven ages. It labels game integration unverified.
- [Trader animation manifest](<../../Art/Trader Icons/Trader_Animation_Manifest.json>) lists six land definitions and twelve clips. It starts at Bronze and labels game integration unverified.
- [Road tile manifest](<../../Art/Terrain/Trade Roads/Road_Tile_Manifest.json>) lists six ages, sixteen cardinal connection masks each, and 96 tiles. It does not implement roads or route rules.
- [Facilities manifest](<../../Art/Building Icons/Facilities-Manifest.json>) records the Armory, Arms Factory, land Oil Well and offshore Oil Rig. [Aviation manifest](<../../Art/Building Icons/Aviation-Manifest.json>) records the airstrip, fighter, bomber and conventional bomb.
- [Strategic/effects manifest](<../../Art/Bomb Icons/Effects-and-Strategic-Manifest.json>) and [explosion manifest](<../../Art/Bomb Icons/Explosions/Effects-Manifest.json>) record strategic static assets and five effect families.
- [Formation manifest](<../../Art/Formation Icons/asset-manifest.json>) and [rank manifest](<../../Art/Formation Icons/Rank Insignias/asset-manifest.json>) establish marker/rank presentation, not a combat promotion system.
- All JSON files discovered in `Art` parsed successfully in this inventory pass. Actual sprite-sheet quality, pivots, generation reports and engine integration were not recertified.

## Missing-art priorities

1. **Opening content:** Stone land trader, Stone mine, Stone field-siege facility/ram; horse nodes and all strategic-deposit map symbols. Do not defer required opening mechanics to Bronze because a sprite is absent.
2. **Fortifications:** Stone/Bronze/Classical wall pieces and towers now exist. Gates, usable construction stages, breach/ruin states, cross-tier transitions if required, and separate later wall-age tiers remain to be authored/verified. Modern uses new gun nests/trenches, with announced art still unverified; old walls remain usable.
3. **Remaining siege art:** Stone field ram and field-siege presentation. Post-Stone unit/clip proposals now exist; complete their visual/runtime validation and authored projectile/ability contracts rather than commissioning duplicate assets.
4. **Late combat:** Modern rifle/marksman/tank animation sets, aircraft movement/attack presentation, strategic/MIRV launch/flight/warhead markers, anti-air vehicles, fixed/mobile MIRV launchers and separate missile-defence art when that capability is authored.
5. **Supply/UI:** distinct raw/material/equipment symbols; new class/ability markers where the seven generic formation icons cannot distinguish tanks, aviation, traders or payloads. Reuse stars for promotion, not age.

The full base tree keeps these missing capabilities explicit. Authoring or generating the missing artwork is a separate production task.
