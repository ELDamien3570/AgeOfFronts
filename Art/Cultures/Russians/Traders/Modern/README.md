# Russian Modern semi-truck

Contemporary olive cab-over tractor and long silver freight semitrailer, facing screen-down in a directly overhead view. This is a generic game design, not a model-exact vehicle reconstruction.

The untouched generated painting is retained in `SourceArt/Trader_Russian_Modern_Generated_v1.png`. The animation master is a uniform Lanczos fit onto a transparent 1254 x 2508 canvas; the vehicle is never stretched. `Generation-Manifest.json` records the full generation prompt and reference.

Idle and Travel each contain ten 512 x 1024 frames, arranged in five columns and two rows. The pivot is (256, 512). Travel scrolls tire tread texture inside fixed wheel silhouettes; cab motion is restrained, and the chassis, fifth-wheel connection, and trailer stay aligned. World motion belongs to the game simulation.

Rebuild only this age from the repository root:

```powershell
python 'Art/Cultures/Russians/Traders/build-animations.py' --age Modern
```

`rig-authoring.json` contains editable motion regions. `Animation_Validation.json` records frame bounds, loop seam checks, fixed wheel alpha, source preservation, and preservation of 837 earlier art files. The extended exporter also reproduces the existing Early Modern Travel frame 3 byte-for-byte.

`Review/Semi-Review.png` shows the tall frame and 48/64/128 pixel width checks. `Review/Travel-Moving-Ground.gif` demonstrates Travel over a scrolling road. The local trader review exposes this unit under Russian / Modern.

These exports are for art review; match renderer integration and artistic acceptance remain unverified.
