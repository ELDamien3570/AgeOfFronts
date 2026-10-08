# Russian Stone Age Scout

Mounted Scout remake: the chestnut horse and Russian Stone Age rider carry a short wooden club with a rounded stone head and leather lashings. The approved idle design now has nine six-frame solo animations: idle, walk, club strike, get hit, get charged, gallop, charge attack, together fall, and thrown rider.

`Idle-v1.png` preserves the approved built-in ImageGen RGBA output and alpha. `Generation.json` and `SourceArt/Generation-*.json` retain full prompts, references, and native source paths. Native atlases remain in `SourceArt/Native-*.png`. The thrown-rider cleanup removes generated motion marks; its original remains preserved.

`SourceArt/compose_animations.py` rebuilds the selected atlases using one uniform whole-pose scale, fixed saddle/root pivots, and authored transparent row gutters. It does not paint artwork or fit individual silhouettes. `SourceArt/Composition.json` records source hashes and frame placements. `animations.json` supplies timings and impact frames. `Validation.json` checks all 54 distinct frames, transparent edge guards, registered preview bounds, and approved-idle preservation.

The Russian Stone Age gallery selects the Scout in place of the mounted spearman. The earlier mounted spearman art, animations, formation archive, and review remain intact and linked from the Scout review footer. `SourceArt/Previous-Cavalry-Catalog.json` preserves the preceding catalog entry. Animations are pending user visual approval; gameplay and runtime formations are separate work.
