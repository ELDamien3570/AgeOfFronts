# Russian Stone Age mounted spearmen formation

Five copies of the approved mounted spearman are composed from `../animations.json`. The approved `Running-v2.png` walk, `Charge-v5.png` gallop, held spear attacks, reactions and both complete death motions remain unchanged. Base civilization art is preserved.

`formation.json` is the editable source for membership, saddle-root slots, phase offsets, timing and passing lanes. The standard layout has two rear riders and three front riders. On charge entry, the rear pair advances into the inner V while the front flanks open lanes and become the trailing pair. Larger rank spacing and a fixed member scale keep the horses readable. Forward ground travel in the review is a visual reference; it does not move a gameplay entity or offset the baked squad origin.

The charge sequence is Charge in → Maintain charge → Charge thrust → Transition out. Maintain charge loops the approved 540 ms gallop in the wedge. The tip thrusts first, then the inner pair, then the trailing pair. Spears remain held. Recovery joins the exit poses, and the exit returns all riders to their exact original slots and idle phases. Actual movement, attack authorization, charge contact and damage remain owned by the existing gameplay domain; these assets do not wire those events.

Death and heavy charge impact reach the front three before the rear pair. Death assigns together-fall to the tip, right flank and rear-right rider, and thrown-rider death to the left flank and rear-left rider. This puts both authored death motions in both ranks. All five horse bodies and five riders reach their complete final poses and remain down.

Ten transparent atlases contain 228 frames at 512x512 per formation frame. `animations.json` records durations, source registration and presentation strike markers; markers are not damage authority. `Validation.json` records source hashes, all member poses, visible bounds and eight-pixel alpha guards. The maximum baked guard alpha is 1 against the existing visible-spill threshold of 16. Low-alpha generator residue remains intact.

The existing formation compiler, pure composition functions and review view model are reused rather than copied. Rebuild with Node and `@napi-rs/canvas` available:

```powershell
node 'Art/Cultures/Russians/Units/StoneAge/Clubman/Formation/build-formation.mjs' 'Art/Cultures/Russians/Units/StoneAge/MountedSpearman/Formation'
node --test 'Art/Cultures/Russians/Units/StoneAge/MountedSpearman/Formation/formation.test.mjs'
```

The eleven structural checks cover membership, complete pose weights, approved gait sources, forward passage, lane clearance, charge seams, loop repetition, strike order, reaction order, mixed held deaths and presentation markers. `Formation_Review.html` offers all ten clips, the four-phase sequence, frame stepping, baked/editable playback, slot guides, moving-ground reference and 64/96/128 px formation previews. The single actor remains available through its footer link.

This is local art and browser review. Formation visual acceptance and gameplay integration remain separate.
