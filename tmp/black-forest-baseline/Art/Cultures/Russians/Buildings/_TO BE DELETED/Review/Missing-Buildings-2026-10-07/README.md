# Missing Russian building art — 2026-10-07

Twenty additive draft icons address the Russian eight-age technology-plan audit: seventeen Early Modern (WWII / mid-twentieth century) icons and three Modern icons. The separately authored Early Modern Military Airstrip is retained unchanged. All base and preexisting Russian PNGs are checked against Before.json, including the shared wall/gate kit.

The user requested shared base walls for every civilization. No culture-specific wall or gate artwork was generated. No gameplay, technology-plan data, production bindings or playable age progression were edited.

The technology planner describes research and unlocks, rather than a complete authoritative building roster. Six research-linked concepts therefore carry proposedBuildingRole=true: Early Modern Rail Terminal, Oil Refinery and Nuclear Weapons Facility, plus Modern Rail Terminal, Drone Facility and Warehouse. Their artwork is ready for review; a separate gameplay building requirement or assignment has not been invented.

| Age | Folder | Research IDs | Proposed facility role |
| --- | --- | --- | --- |
| EarlyModern | Barracks | modern-modern-armaments | No |
| EarlyModern | City | modern-industrial-production | No |
| EarlyModern | Archery Range | russian-machine-gun-teams | No |
| EarlyModern | Vehicle Depot | russian-gun-trucks, russian-apc-production, russian-tank-production | No |
| EarlyModern | Arms Factory | modern-modern-armaments | No |
| EarlyModern | Siege Workshop | modern-modern-armaments | No |
| EarlyModern | Factory | modern-industrial-production | No |
| EarlyModern | Port | modern-powered-vessels | No |
| EarlyModern | Mine | modern-petroleum-extraction | No |
| EarlyModern | Oil Well | modern-petroleum-extraction | No |
| EarlyModern | Oil Rig | modern-petroleum-extraction | No |
| EarlyModern | Gun Nest | russian-machine-gun-teams | No |
| EarlyModern | Trench | modern-combined-arms | No |
| EarlyModern | Anti-Aircraft Emplacement | russian-anti-aircraft-guns | No |
| EarlyModern | Rail Terminal | russian-rail-freight | Yes |
| EarlyModern | Oil Refinery | russian-oil-refining | Yes |
| EarlyModern | Nuclear Weapons Facility | modern-strategic-weapons | Yes |
| Modern | Rail Terminal | russian-advanced-rail-networks | Yes |
| Modern | Drone Facility | russian-battlefield-drones | Yes |
| Modern | Warehouse | russian-intelligent-warehouses | Yes |

Generated.json and per-folder Generation.json retain the exact prompts, reference paths, built-in image_gen output paths, selected versioned masters and SHA-256 hashes. All image creation and camera editing used the built-in image_gen tool. The initial masters are retained alongside corrected selections. Historical scope is an era-inspired game-art interpretation; these are not reconstructions of specific factories or facilities.

The primary [Museum of Moscow industrial-history exhibition](https://mosmuseum.ru/tours/p/gorod-sozidatelei/) informed the broad industrial direction, rather than any exact site layout. Camera and palette references are existing Russian airstrip and Modern factory artwork. The AA emplacement is period-inspired; no exact weapon-model fidelity claim is made.

Source-Validation.json verifies PNG transparency, selected-master parity, research IDs, roster uniqueness and preservation of the prior image baseline. Browser-Validation.json records separate local headless Edge checks of filters, 48/64/128 px previews, comparison dialogs, backgrounds and empty selections. Static/browser checks do not establish artistic approval or game-runtime integration. All additions remain drafts for user review.
