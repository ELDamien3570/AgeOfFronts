# Russian Stone Age clubmen formation

Five copies of the approved single soldier form a standard two-back, three-front group. The original single-actor files remain one level above this folder. Base civilization art is untouched.

`formation.json` is the editable source for member slots, pose phase offsets, reaction delays and the four charge phases. `formation-composition.js` samples and paints that data. `build-formation.mjs` bakes ten transparent sprite sheets with explicit frame rectangles and a shared formation pivot. `animations.json` and the PNGs are build outputs; edit the tracks or actor metadata and rebuild rather than manually editing those outputs.

- **Charge in:** 1,080 ms; establish the charge gait for 150 ms, then form the wedge over 720 ms. The standard rear pair runs forward into the inner wedge; the front flanks arc outward to open passing lanes, then settle into the trailing pair. The center remains the tip. Rear soldiers shift sideways only 8 px; the flanks finish 18 px outward, with a temporary 40 px arc to keep the pass clear. The previous reshuffle moved members sideways 54–80 px.
- **Maintain charge:** a 540 ms loop in the wedge. Its duration is not a gameplay timeout.
- **Charge attack:** 1,300 ms; tip starts immediately, inner pair (`rear-left`/`rear-right`) at 180 ms, trailing pair (`left`/`right`) at 360 ms. Member IDs refer to their original standard slots; `chargeSequence.wedgeRoles` records their charge roles. The new single-actor strike lives in `SourceActor/`, with its ImageGen prompts and rejected source retained.
- **Transition out:** 1,080 ms; establish the walking gait for 140 ms, restore each member to his original standard slot over 720 ms, then settle into idle for 220 ms.
- **Death and get charged:** front starts at 0/40/80 ms, rear at 320/370 ms. All five finish death on the final fallen pose.

The review page plays the baked assets by default and can switch to the editable composition. Full charge sequence uses three Maintain charge cycles only to demonstrate the sequence. Individual Maintain charge loops continuously.

**Show forward travel** scrolls a ground reference beneath the centered formation. `reviewTravel` is an editable inspection speed, with entry/exit ramps; all five advance relative to that ground during the reshuffle. It is not root motion, a gameplay speed, or an offset baked into the PNGs. Without a ground reference, the centered outer soldiers visibly fall back relative to the tip even while their gait continues forward. The loop's ground reference is continuous across Maintain charge cycles and stops during the strike.

Optional `layoutTracks` contain per-member axis keyframes measured from the end of the gait setup delay. The flank x tracks open lanes during both transitions, while their y tracks use the standard smooth layout interpolation. The passing soldiers maintain at least 94 px lateral separation when their rows are within 45 px.

This is presentation artwork. Member slot offsets never change squad position, collision, pathfinding or combat. The presentation state contract is recorded for later integration: enter automatically leads to maintain; contact requests attack; attack leads to exit; exit leads to idle. Gameplay owns contact, cancellation and damage events. Presentation strike markers are alignment references, not damage authority. A cancel during Maintain charge may request Transition out without a strike; integrate and interrupt this through the existing game systems when requested.

To rebuild with Node and `@napi-rs/canvas` installed:

```powershell
node 'Art/Cultures/Russians/Units/StoneAge/Clubman/Formation/build-formation.mjs'
node --test 'Art/Cultures/Russians/Units/StoneAge/Clubman/Formation/formation.test.mjs'
```

For the Codex bundled runtime, set `ART_CANVAS_MODULE` to its discovered `node_modules/@napi-rs/canvas` directory before running the build. No repository package installation is required.

`Validation.json` records source hashes, guards, all 207 baked samples and the five member poses per sample. Structural tests cover front-to-back reactions, death completion, member preservation, loop stability, phase continuity and exact restoration of the standard layout. Browser review and engine integration are distinct gates; visual acceptance remains with the user.
