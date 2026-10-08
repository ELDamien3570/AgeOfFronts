# Russian Classical Age Recurve Archer

Single actor animation set: idle, walk, bow shot, reload, get hit, get charged, charge running, advance-and-shoot, side death and back death. Six frames per clip. Early hammered iron helmet, shoulder caps, wristguards and overlapping torso plates over reddish-brown leather, cream fur, recurve bow, iron-tipped arrow and leather quiver. Imagined ancestral Russian roster.

The regular and charge shots aim straight screen-bottom. The arrow disappears on frame 4 (zero-based releaseFrame 3); reload is a separate clip. animations.json records durations, roots and weapon-state transitions. Runtime owns projectile creation, ammunition, timing and formations.

SourceArt/Animation-Generation.json preserves built-in ImageGen prompts, references and selections. Native atlases are preserved; compose_animations.py bakes whole cells at a uniform scale with transparent padding and fixed authored roots, without repainting poses or filtering alpha. Rebuild with Python and Pillow: python Art/Cultures/Russians/Units/ClassicalAge/RecurveArcher/SourceArt/compose_animations.py.

Validation.json verifies 60 unique nonempty frames, transparent guards, registered preview bounds and preservation of the approved Idle-v1.png. Browser-Review.json records local inspection. Animations remain pending user visual approval; match-runtime integration is separate. Approved masters and base art are preserved.
