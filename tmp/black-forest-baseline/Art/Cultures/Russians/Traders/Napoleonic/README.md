# Russian Napoleonic caravan

Two merchant-centered formations in single file, each with one horse-drawn cart on either side: two merchants, four horses and four carts. User requested the same visual design with double-height resolution.

SourceArt retains the original 887 x 1774 imagegen output and its uniform 1254 x 2508 authoring export. The source export has no stretched geometry. Idle and Travel use 512 x 1024 frames in 2560 x 2048 sheets, centered pivot (256,512), ten frames each. The viewer and scale comparison preserve the 1:2 aspect ratio. This remains art-review-only; match integration is unchanged.

Rebuild: `python build-animations.py --age Napoleonic` from the trader root. Fixed limb registration, engine-free four-beat horse walk and merchant footfalls are in rig-authoring.json. Validation and moving-ground review GIF are in Review and Animation_Validation.json. Earlier masters, sprites and metadata remain unchanged.
