# Russian Classical Age trader

The static review master depicts two merchants, one horse-drawn loaded wagon
and one pack horse carrying tied felt panniers. The goods use wool/felt,
furs, iron and pottery; wheel treads are smooth. The camera is vertically
overhead and the party faces down.

The user approved the master for animation. Idle and Travel are exported as
RGBA 2560 × 1024 sheets: ten 512 × 512 frames in a five-by-two grid, center
pivot, 8 fps Idle and 12 fps Travel. The source master, its native alpha and
dimensions are preserved under `SourceArt/`. The existing browser
review shows both loops and a comparison at current game screen sizes.
This does not certify match-runtime integration.

This is a regional Iron Age game interpretation. Sources, exact built-in
imagegen prompt, references, generated path and selected source hash are in
`Generation-Manifest.json`. Base art and earlier Russian traders are preserved.

Each merchant has two articulated painted legs. Each horse has four legs with
independent quarter-cycle contact phases. Twelve legs share a contact velocity
but have distinct phases; stance plants the foot and recovery lifts it through
a bent joint pose. The approved wagon, shafts, leads, harness and secured goods
remain in the retained body assembly, while wheel grain rolls inside smooth
fixed silhouettes. Rear knees use the forward-folding stifle direction so
upper-leg paint stays beneath the rump and panniers.

Revision 2 corrects the forelegs after the user's motion review: narrower
shoulder anchors and hoof paths, slender cannon paint and a separate fetlock
and pastern link. Body paint occludes the legs naturally in the overhead view.
Both animals retain independent four-beat contact phases.

`rig-authoring.json` contains all member anchors, lengths, stride and removal
masks. `../caravan-rig.py` owns the offline articulation and export. `layers/`
contains twenty-four separate painted limb textures and the retained body.
The horse atlas and generated provenance are in `SourceArt/` and
`Animation-Support-Generation.json`; human limbs reuse the existing shared
atlas. `animations.json` records all twelve foot tracks and a moving-ground
speed used only by the browser review. Simulation owns actual translation.

From the repository root:

```powershell
python Art/Cultures/Russians/Traders/build-animations.py --age ClassicalAge
python Art/Cultures/Russians/Traders/validate-animations.py --age ClassicalAge
```

`Animation_Validation.json` checks twenty frames, loop seams, transparent
guards, bone lengths, full stride/lift, constant-speed planted contact, fixed
protected cargo/wagon paint and unchanged earlier art. `Review/Walking_Review.webp`
shows Idle and Travel with a moving-ground reference. `Review/Browser_Validation.json`
records live playback and game-scale inspection.

Open `/Trader%20Icons/Trader_Animation_Preview.html?culture=russian#ClassicalAge`
on the local art server.

