# Default culture: age-by-age technology map

Generated from [the complete base catalogue](base-tech-tree.md), September 30, 2026. All prices/timers are proposals. The tables in that catalogue are the source of truth; regenerate this map when content changes.

Each tree usually has a foundation, two independent branches and a final node requiring both. Bronze Warfare adds Armies as a fifth node branching from Bronze Equipment. Complete every node in any two current-age trees to qualify for the paid/timed age advance. Catch-up prerequisites stay in the same tree; every foundation after Stone also requires its empire age and previous tree completion. Classical Warfare requires both Fortified Settlements and Armies.

## Stone Age

Flint Weapons and Settlements are already completed. Start with three melee formations and no buildings.

```mermaid
flowchart TB
    subgraph S_N["Naval"]
        direction TB
        S_N1["Shorecraft<br/>2,000 gold / 30s"]
        S_N2["Cargo Canoes<br/>3,000 gold / 35s"]
        S_N3["War Canoes<br/>3,000 gold / 35s"]
        S_N4["Coastal Navigation<br/>4,500 gold / 45s"]
        S_N1 --> S_N2
        S_N1 --> S_N3
        S_N2 --> S_N4
        S_N3 --> S_N4
    end
    subgraph S_W["Warfare"]
        direction TB
        S_W1["Flint Weapons<br/>Starting grant"]
        S_W2["Spear Throwing<br/>3,000 gold / 35s"]
        S_W3["Horsemanship<br/>2,500 gold / 25s"]
        S_W4["Field Engineering<br/>4,500 gold / 45s"]
        S_W1 --> S_W2
        S_W1 --> S_W3
        S_W2 --> S_W4
        S_W3 --> S_W4
    end
    subgraph S_E["Economic"]
        direction TB
        S_E1["Settlements<br/>Starting grant"]
        S_E2["Craft Workshops<br/>3,000 gold / 35s"]
        S_E3["Stone Mining<br/>3,000 gold / 35s"]
        S_E4["Goods Handling<br/>4,500 gold / 45s"]
        S_E1 --> S_E2
        S_E1 --> S_E3
        S_E2 --> S_E4
        S_E3 --> S_E4
    end
```

After any two of these trees finish: advance to Bronze Age for 50,000 gold and the proposed 40 seconds.

## Bronze Age

Each foundation also requires Bronze Age empire age and the corresponding Stone Age final technology.

```mermaid
flowchart TB
    subgraph B_N["Naval"]
        direction TB
        B_N1["Planked Hulls<br/>6,000 gold / 40s"]
        B_N2["Merchant Sailing<br/>7,000 gold / 45s"]
        B_N3["Oared Warships<br/>7,000 gold / 45s"]
        B_N4["Naval Organisation<br/>10,000 gold / 55s"]
        B_N1 --> B_N2
        B_N1 --> B_N3
        B_N2 --> B_N4
        B_N3 --> B_N4
    end
    subgraph B_W["Warfare"]
        direction TB
        B_W1["Bronze Equipment<br/>6,000 gold / 40s"]
        B_W2["Bowcraft<br/>7,000 gold / 45s"]
        B_W3["Chariot Warfare<br/>7,000 gold / 45s"]
        B_W4["Fortified Settlements<br/>10,000 gold / 55s"]
        B_W5["Armies<br/>7,000 gold / 45s<br/>20 squad formations"]
        B_W1 --> B_W2
        B_W1 --> B_W3
        B_W1 --> B_W5
        B_W2 --> B_W4
        B_W3 --> B_W4
    end
    subgraph B_E["Economic"]
        direction TB
        B_E1["Bronze Metallurgy<br/>6,000 gold / 40s"]
        B_E2["Urban Workshops<br/>7,000 gold / 45s"]
        B_E3["Road Networks<br/>7,000 gold / 45s"]
        B_E4["Civic Administration<br/>10,000 gold / 55s"]
        B_E1 --> B_E2
        B_E1 --> B_E3
        B_E2 --> B_E4
        B_E3 --> B_E4
    end
```

After any two of these trees finish: advance to Classical Age for 75,000 gold and the proposed 45 seconds.

## Classical Age

Each foundation also requires Classical Age empire age and the corresponding Bronze Age final technology. Professional Infantry additionally requires B-W5 Armies, so Warfare catch-up retains the whole five-node Bronze tree.

```mermaid
flowchart TB
    subgraph C_N["Naval"]
        direction TB
        C_N1["Shipyards<br/>10,000 gold / 45s"]
        C_N2["Transport Fleets<br/>12,000 gold / 50s"]
        C_N3["Galley Warfare<br/>12,000 gold / 50s"]
        C_N4["Naval Logistics<br/>16,000 gold / 60s"]
        C_N1 --> C_N2
        C_N1 --> C_N3
        C_N2 --> C_N4
        C_N3 --> C_N4
    end
    subgraph C_W["Warfare"]
        direction TB
        C_W1["Professional Infantry<br/>10,000 gold / 45s"]
        C_W2["Ranged Warfare<br/>12,000 gold / 50s"]
        C_W3["Cavalry Tactics<br/>12,000 gold / 50s"]
        C_W4["Masonry Engineering<br/>16,000 gold / 60s"]
        C_W1 --> C_W2
        C_W1 --> C_W3
        C_W2 --> C_W4
        C_W3 --> C_W4
    end
    subgraph C_E["Economic"]
        direction TB
        C_E1["Ironworking<br/>10,000 gold / 45s"]
        C_E2["Urban Planning<br/>12,000 gold / 50s"]
        C_E3["Caravan Roads<br/>12,000 gold / 50s"]
        C_E4["Husbandry<br/>16,000 gold / 60s"]
        C_E1 --> C_E2
        C_E1 --> C_E3
        C_E2 --> C_E4
        C_E3 --> C_E4
    end
```

After any two of these trees finish: advance to Early Medieval for 110,000 gold and the proposed 50 seconds.

## Early Medieval

Each foundation also requires Early Medieval empire age and the corresponding Classical Age final technology.

```mermaid
flowchart TB
    subgraph EMed_N["Naval"]
        direction TB
        EMed_N1["Framed Hulls<br/>16,000 gold / 50s"]
        EMed_N2["Seafaring<br/>18,000 gold / 55s"]
        EMed_N3["Coastal Warships<br/>18,000 gold / 55s"]
        EMed_N4["Landing Logistics<br/>26,000 gold / 65s"]
        EMed_N1 --> EMed_N2
        EMed_N1 --> EMed_N3
        EMed_N2 --> EMed_N4
        EMed_N3 --> EMed_N4
    end
    subgraph EMed_W["Warfare"]
        direction TB
        EMed_W1["Mail Equipment<br/>16,000 gold / 50s"]
        EMed_W2["Bow and Bolt Warfare<br/>18,000 gold / 55s"]
        EMed_W3["Mounted Spearmen<br/>18,000 gold / 55s"]
        EMed_W4["Trebuchet Engineering<br/>26,000 gold / 65s"]
        EMed_W1 --> EMed_W2
        EMed_W1 --> EMed_W3
        EMed_W2 --> EMed_W4
        EMed_W3 --> EMed_W4
    end
    subgraph EMed_E["Economic"]
        direction TB
        EMed_E1["Agricultural Organisation<br/>16,000 gold / 50s"]
        EMed_E2["Craft Guilds<br/>18,000 gold / 55s"]
        EMed_E3["Caravan Breeding<br/>18,000 gold / 55s"]
        EMed_E4["Market Logistics<br/>26,000 gold / 65s"]
        EMed_E1 --> EMed_E2
        EMed_E1 --> EMed_E3
        EMed_E2 --> EMed_E4
        EMed_E3 --> EMed_E4
    end
```

After any two of these trees finish: advance to Late Medieval for 160,000 gold and the proposed 55 seconds.

## Late Medieval

Each foundation also requires Late Medieval empire age and the corresponding Early Medieval final technology.

```mermaid
flowchart TB
    subgraph LMed_N["Naval"]
        direction TB
        LMed_N1["Sailing Hulls<br/>24,000 gold / 55s"]
        LMed_N2["Merchant Convoys<br/>28,000 gold / 65s"]
        LMed_N3["Naval Gunnery<br/>28,000 gold / 65s"]
        LMed_N4["Broadside Tactics<br/>40,000 gold / 75s"]
        LMed_N1 --> LMed_N2
        LMed_N1 --> LMed_N3
        LMed_N2 --> LMed_N4
        LMed_N3 --> LMed_N4
    end
    subgraph LMed_W["Warfare"]
        direction TB
        LMed_W1["Steel Equipment<br/>24,000 gold / 55s"]
        LMed_W2["Crossbows and Field Guns<br/>28,000 gold / 65s"]
        LMed_W3["Lance Knights<br/>28,000 gold / 65s"]
        LMed_W4["Siege Ordnance<br/>40,000 gold / 75s"]
        LMed_W1 --> LMed_W2
        LMed_W1 --> LMed_W3
        LMed_W2 --> LMed_W4
        LMed_W3 --> LMed_W4
    end
    subgraph LMed_E["Economic"]
        direction TB
        LMed_E1["Steelmaking<br/>24,000 gold / 55s"]
        LMed_E2["Powder Milling<br/>28,000 gold / 65s"]
        LMed_E3["Guild Commerce<br/>28,000 gold / 65s"]
        LMed_E4["Urban Administration<br/>40,000 gold / 75s"]
        LMed_E1 --> LMed_E2
        LMed_E1 --> LMed_E3
        LMed_E2 --> LMed_E4
        LMed_E3 --> LMed_E4
    end
```

After any two of these trees finish: advance to Early Modern for 230,000 gold and the proposed 60 seconds.

## Early Modern

Each foundation also requires Early Modern empire age and the corresponding Late Medieval final technology.

```mermaid
flowchart TB
    subgraph EMod_N["Naval"]
        direction TB
        EMod_N1["Ocean Navigation<br/>35,000 gold / 65s"]
        EMod_N2["Ocean Transport<br/>40,000 gold / 75s"]
        EMod_N3["Ships of the Line<br/>40,000 gold / 75s"]
        EMod_N4["Fleet Coordination<br/>55,000 gold / 90s"]
        EMod_N1 --> EMod_N2
        EMod_N1 --> EMod_N3
        EMod_N2 --> EMod_N4
        EMod_N3 --> EMod_N4
    end
    subgraph EMod_W["Warfare"]
        direction TB
        EMod_W1["Firearms<br/>35,000 gold / 65s"]
        EMod_W2["Musket and Artillery Drill<br/>40,000 gold / 75s"]
        EMod_W3["Pistoliers<br/>40,000 gold / 75s"]
        EMod_W4["Howitzer Engineering<br/>55,000 gold / 90s"]
        EMod_W1 --> EMod_W2
        EMod_W1 --> EMod_W3
        EMod_W2 --> EMod_W4
        EMod_W3 --> EMod_W4
    end
    subgraph EMod_E["Economic"]
        direction TB
        EMod_E1["Powder Manufactories<br/>35,000 gold / 65s"]
        EMod_E2["Manufactories<br/>40,000 gold / 75s"]
        EMod_E3["Long-Distance Commerce<br/>40,000 gold / 75s"]
        EMod_E4["Military Provisioning<br/>55,000 gold / 90s"]
        EMod_E1 --> EMod_E2
        EMod_E1 --> EMod_E3
        EMod_E2 --> EMod_E4
        EMod_E3 --> EMod_E4
    end
```

After any two of these trees finish: advance to Modern for 330,000 gold and the proposed 65 seconds.

## Modern

Each foundation also requires Modern empire age and the corresponding Early Modern final technology.

```mermaid
flowchart TB
    subgraph M_N["Naval"]
        direction TB
        M_N1["Powered Vessels<br/>50,000 gold / 75s"]
        M_N2["Amphibious Transport<br/>60,000 gold / 90s"]
        M_N3["Modern Warships<br/>60,000 gold / 90s"]
        M_N4["Fleet Operations<br/>90,000 gold / 120s"]
        M_N1 --> M_N2
        M_N1 --> M_N3
        M_N2 --> M_N4
        M_N3 --> M_N4
    end
    subgraph M_W["Warfare"]
        direction TB
        M_W1["Modern Armaments<br/>50,000 gold / 75s"]
        M_W2["Combined Arms<br/>60,000 gold / 90s"]
        M_W3["Military Aviation<br/>60,000 gold / 90s"]
        M_W4["Strategic Weapons<br/>90,000 gold / 120s"]
        M_W1 --> M_W2
        M_W1 --> M_W3
        M_W2 --> M_W4
        M_W3 --> M_W4
    end
    subgraph M_E["Economic"]
        direction TB
        M_E1["Petroleum Extraction<br/>50,000 gold / 75s"]
        M_E2["Industrial Production<br/>60,000 gold / 90s"]
        M_E3["Motor Freight<br/>60,000 gold / 90s"]
        M_E4["Integrated Logistics<br/>90,000 gold / 120s"]
        M_E1 --> M_E2
        M_E1 --> M_E3
        M_E2 --> M_E4
        M_E3 --> M_E4
    end
```

Modern has no further age or automatic victory. Combined Arms also grants gun nests/trenches and aircraft-only anti-air vehicles; existing walls remain usable. Strategic Weapons also grants fixed and mobile MIRV launchers. These are capability bundles within the existing nodes, not extra counted technologies. Missile defence is separate and its placement remains open. See [Modern rules](modern-defences-and-strategic-weapons.md). Ordinary victory follows the configured solo/allied mode.

## Cross-cutting rules

Promotions use combat XP and seven-level star overlays. Completed age refits reset promotion to recruit. Charge is a definition-specific ability, not extra counted research. Siege projectiles/bombs have separate Projectile Size and Blast Radius. See [combat rules](combat-and-promotions.md) and [art evidence](base-tech-tree-art-audit.md).
