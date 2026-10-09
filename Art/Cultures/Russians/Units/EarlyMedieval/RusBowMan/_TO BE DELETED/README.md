# Russian Early Medieval Rus Bow Man

Single overhead actor based on the user-supplied archer illustration: patterned iron helmet, mail coif and chainmail, red tunic and boots, green chest panel, leather straps and quiver, dark curved bow. The reference is used as a visual design reference for the imagined Russian roster.

Ten six-frame clips: idle, walk, bow shot, reload, light hit, charge impact, charge running, advance-and-shoot, side death and back death. The overhead idle design is approved; animations await user visual review.

SourceArt/Animation-Generation.json and Shot-Corrections.json record built-in ImageGen prompts and selected sources. SourceArt/compose_animations.py bakes whole poses at one uniform scale with transparent padding and authored roots. The normal-shot ready frame is retained from the first atlas; source selection is recorded per frame in Composition.json. No pixel painting or alpha filtering is used. Rebuild with Python and Pillow: python Art/Cultures/Russians/Units/EarlyMedieval/RusBowMan/SourceArt/compose_animations.py.

animations.json records frame timings, roots and releaseFrame 3 (the fourth frame). Shots end with an empty bow; reload is separate. Runtime owns projectiles, ammunition, timing and formations. Validation.json checks 60 unique nonempty frames, transparent guards, preview bounds and preservation of approved Idle-TopDown-v2.png. Browser-Review.json records local inspection. Both static designs and all native sources remain preserved; match-runtime integration is separate.

