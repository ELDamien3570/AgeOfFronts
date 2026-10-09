# Russian Classical Age boats

The user approved all three masters for animation. Seven clips are exported:
warship Idle, Sailing and Attack; transport Idle and Sailing; trade Idle and
Sailing. Base art and the approved Stone and Bronze Age boats are preserved.

- Warship: plank-built fighting hull, six complete straight oar pairs,
  two iron-tipped spare spears and two secured shields.
- Transport: broad open passenger hull, eight pale benches and stowed paddles.
- Trade: single cargo hull, six large secured loads and stowed paddles.

The camera remains vertically overhead, bow up. Native generated dimensions
and alpha are preserved; the review frames each master inside a 512-pixel
canvas without changing its aspect ratio. Each clip contains ten frames on an
RGBA 2560 × 1024 sheet, with 512 × 512 cells in a five-by-two grid and center
pivot. Idle runs at 8 fps, Sailing at 12 fps and Attack at 10 fps. Its lower fleet study uses the
current game display sizes, opacity and atlas sampling. This is browser art
review, not match-runtime integration.

Regional Iron Age river-basin archaeology informs materials and trade context.
Exact specialized vessel classes, hull construction and deck arrangements are
gameplay interpretations. Sources, exact built-in imagegen prompts, iterations,
original generated paths and selected source hashes are recorded in
`Generation-Manifest.json`. Source PNGs are under each role's `SourceArt/`.

The twelve working oars are separate rigid painted layers rotating about
fixed gunwale pivots. A generated underlay fills only the exposed original
oar mask areas; its prompt and provenance are in
`Animation-Support-Generation.json`. Native source dimensions are retained.
Cargo, benches, shields, spare spears and stowed paddles remain attached.
Sailing water and the forward iron-spear release are separate visual passes;
event frames do not control gameplay. Editable masks, pivots and amplitude
settings are in `rig-authoring.json` and each role's `rig.json`/`layers/`.

Rebuild only this age from the repository root:

```powershell
python Art/Cultures/Russians/Ships/build-animations.py --age ClassicalAge
```

`Animation_Validation.json` checks all seven sheets and seventy frames,
transparency guards, loop seams, effect-pass composition and unchanged masters.
The shared earlier-art preservation audit is in
`Review/Animation_Preservation_Baseline.json`.

Open `/Ship%20Icons/Ship_Animation_Preview.html?culture=russian#ClassicalAge`
on the local art server. The existing Base/Russian selector remains available.

