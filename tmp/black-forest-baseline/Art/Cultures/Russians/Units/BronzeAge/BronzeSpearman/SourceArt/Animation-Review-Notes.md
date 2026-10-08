# Bronze Spearman animation review

2026-10-07: The user approved the rear spear grip and enlarged shield idle design, then requested animation.

Nine six-frame single-actor clips were generated with built-in ImageGen: idle, walk, spear thrust, get hit, get charged, charge in / maintain, charge attack, side death, and backward death. New animations await user artistic review. Base artwork and all approved design sources remain preserved. No gameplay or formation integration was performed.

`Animation-Generation.json` preserves exact prompts and native output paths. `Native-*.png` retains the selected generated sheets. `Composition.json` records authored pose rectangles, fixed roots, and the common 0.80 bake scale. `compose_animations.py` reproduces whole-pose atlas composition with transparent padding; it does not paint equipment or filter alpha.

The generated walk and thrust sources straddle nominal row boundaries in a few cells. Authored gutters isolate the complete poses before baking, so adjacent poses cannot leak into review frames. The side-fall source similarly uses an authored second-column gutter. Every output uses the same scale, independent of silhouette bounds.

Validation: all nine RGBA sheets are 1536 by 1024, contain six distinct frames, retain zero alpha across each eight-pixel cell border, and fit the registered 400px review footprint. The approved idle hash is unchanged. Browser review loads all nine clips without console warnings or errors; ordinary thrust, charge thrust, walk, and both final death poses were inspected. Static/browser checks are not runtime integration or user animation approval.
