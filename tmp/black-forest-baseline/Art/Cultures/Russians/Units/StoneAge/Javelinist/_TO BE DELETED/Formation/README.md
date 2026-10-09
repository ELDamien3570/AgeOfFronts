# Russian Stone Age javelinist formation

Five approved javelinists use the standard two-back, three-front ranks and the approved V-shaped wedge paths. The single actor and base civilization artwork are preserved.

`formation.json` is the editable source for slots, gait phases, member delays, source assignments and charge transitions. The shared composer and compiler live in `../../Clubman/Formation/`; this folder reuses that pipeline and its review view model rather than duplicating them. Optional per-member source assignments select authored death variants. Existing clubman tracks and sheets are unchanged.

Death has two full six-pose motions, not just different start times or rotated copies. `tip`, `right` and `rear-left` use the approved knee-buckle and side collapse. `left` and `rear-right` use the new recoil and backward fall, ending on their back. Front starts are 0/40/80 ms; rear starts are 320/370 ms. All five hold their final corpse. The complete formation death lasts 1,580 ms.

The second death source, its retained rejected attempt, authored pivots and exact built-in ImageGen prompts are in `SourceActor/`. `Death-Back-v2.png` is selected after correcting cell spill. Its fixed playback scale restores the padded source to the approved soldier size; source alpha remains intact.

The four charge phases are: charge in (1,080 ms), Maintain charge (540 ms loop), planted charge volley (1,400 ms), and transition out (1,080 ms). The original rear pair runs into the inner wedge; front flanks open lanes and become the trailing pair. During the volley, waiting soldiers use the planted ready pose instead of continuing to run. Tip begins first, inner pair at 180 ms, trailing pair at 360 ms. All five rearm before exit restores standard ranks.

Normal and charge volleys contain presentation release markers derived from the approved actor release frame. Projectiles remain separate from the actor atlas. Gameplay owns target range, attack authorization, projectile timing, damage and world movement. This work changes art review and baking only. The moving review ground is an inspection reference and is never baked as squad root motion.

`Formation_Review.html` opens the baked atlases by default, with optional editable composition, repeat, frame stepping, slot guides and 64/96/128 px previews. Single-soldier review remains linked. `Validation.json` records source hashes, two death assignments, all 215 samples and clipping guards. User visual acceptance and gameplay integration are separate from these checks.

Rebuild from the repository root with Node and `@napi-rs/canvas`:

```powershell
node 'Art/Cultures/Russians/Units/StoneAge/Clubman/Formation/build-formation.mjs' 'Art/Cultures/Russians/Units/StoneAge/Javelinist/Formation'
node --test 'Art/Cultures/Russians/Units/StoneAge/Javelinist/Formation/formation.test.mjs'
```

For the bundled runtime, set `ART_CANVAS_MODULE` to its discovered `node_modules/@napi-rs/canvas` directory. No repository dependency installation is needed.
