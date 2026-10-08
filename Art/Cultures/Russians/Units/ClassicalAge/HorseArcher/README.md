# Russian Classical Age Horse Archer

Nine solo animations (54 frames) based on the approved horse archer idle: idle, walk, bow shot, get hit, get charged, gallop / maintain charge, charge shot, together fall, and thrown rider. The rider holds the recurve bow in his anatomical left hand and draws with his right. The thrown death releases the bow rather than switching hands.

`Idle-v3.png` is the preserved approved native idle reference. Earlier idle versions are retained. Built-in ImageGen created the whole animation poses; `SourceArt/compose_animations.py` applies a common scale, transparent padding, and fixed saddle anchors. Native alpha and every source version are preserved. `Generation.json` records prompts and references; `SourceArt/Composition.json` records the reproducible bake. Attack release is frame 4 (zero-based impactFrame 3).

Open `Actor_Review.html` through the art inspection server. `Review-Forward-BowShot-v2.png` and `Review-Forward-ChargeShot-v2.png` record the revised shots, with greater torso rotation and near-forward arrow direction, including 32, 48, and 64 px views. The seven other clips are user-approved and their hashes remain unchanged. Earlier screenshots and sources remain. The padded charge-shot source uses one authored display scale across all six poses. Revised shots await user review; gameplay integration remains separate.

## Shot style correction

Attack-StyleMatched-v6.png and Charge-Attack-StyleMatched-v9.png replace the two forward shots. Built-in ImageGen rebuilt poses directly from Idle-v3.png as the material and rendering reference, with the previous shots used only for pose guidance. The new shots reduce saturation and coarse outlining while retaining forward aim. All seven approved non-shot output hashes remain unchanged. Generation.json retains prompts and references; SourceArt retains every native draft. Replacement shots await user review.

## Arrow grip correction

The selected shots are Attack-ArrowGrip-v7.png and Charge-Attack-ArrowGrip-v11.png. Arrow shafts now cross beside the left bow hand in draw frames 2 and 3. Frame 1 and frames 4-6 are copied whole from the preceding style-matched sheets, preserving ready, release and recovery pixels exactly. Composition.json records each frame source and hash. Both draws were inspected in browser; Review-ArrowGrip screenshots record the result. Seven non-shot clips remain unchanged.
