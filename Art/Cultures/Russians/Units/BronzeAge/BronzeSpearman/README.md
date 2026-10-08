# Russian Bronze Age Bronze Spearman

Nine overhead single-actor animations are available for user review: idle, walk, spear thrust, get hit, get charged, charge in / maintain, heavy charge thrust, side death, and backward death. Each clip has six frames. Armor, leather clothing, fur collar and large round shield follow the approved idle design; the weapon is a leaf-shaped bronze spear with a rear grip.

Main attack grip correction: selected `Attack-Overhand-v2.png` replaces only frames 3 and 4 with raised overhand grips. Frames 1, 2, 5, and 6 are pixel-identical to `Attack-v1.png`; clip timings, pivots, and the approved charge attack are unchanged. Exact built-in ImageGen prompts and preserved native outputs are in `SourceArt/Thrust-Grip-Generation.json`; the cell composition is reproducible with `SourceArt/compose_thrust_grip.py`. Run that correction after the original `compose_animations.py` when rebuilding the complete set. The revised main attack awaits user review.

Initial design history: `Idle-v1.png` preserves the native RGBA output at 1254x1254. `Generation.json` records the exact built-in ImageGen prompts and references. Earlier single-frame metadata is preserved in `SourceArt/Before-Animation-animations.json`.

The actor page and Russian Bronze Age gallery expose all nine clips. The idle design is approved; new animations await artistic review. Formations will use runtime instances. Gameplay integration is separate.

`SourceArt/Animation-Generation.json` preserves the exact built-in ImageGen prompt set. Selected native sheets and the approved single idle remain intact. `SourceArt/Composition.json` and `SourceArt/compose_animations.py` retain editable whole-pose extraction, a common bake scale, and fixed pivots. No per-frame silhouette fitting is used. `animations.json` contains the selected atlas frames and timing; `Validation.json` verifies 54 frames, transparent cell padding, preview bounds, and preservation of the approved idle. See `SourceArt/Animation-Review-Notes.md` for review evidence and authored gutters.

Rear-grip design revision: `Idle-RearGrip-v2.png` moves the spear hand toward the upper-left butt and bends the weapon arm; original idle remains intact. Exact built-in ImageGen prompt and prior review metadata are retained in `SourceArt/Rear-Grip-Generation.json` and `SourceArt/Rear-Grip-Before.json`.

Approved large-shield design: `Idle-LargeShield-v3.png` enlarges the round shield, prompted at 1.5x width and height, while retaining the rear spear grip. Earlier idle sprites remain intact; exact built-in ImageGen prompt and prior metadata are retained in `SourceArt/Large-Shield-Generation.json` and `SourceArt/Large-Shield-Before.json`. This approved single-frame master is the reference for all nine animations.
