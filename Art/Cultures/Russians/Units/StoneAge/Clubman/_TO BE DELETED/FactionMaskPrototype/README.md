# Clubman fabric-mask prototype

Four masks correspond exactly to the current runtime Clubman sheets in Art/Runtime/Russians/Troops/StoneAge-Clubman: idle, running, attack, death. Each is 768 x 128, with six 128 x 128 frames. These masks do not match the larger authoring sheets or the five additional authoring-only clips.

Encoding: 8-bit grayscale, black = preserve original, white = replace fabric chroma, gray = partial coverage. Keep the sprite alpha separately. Use the original shading/value for the recolored fabric, then blend by mask coverage. Do not multiply the entire sprite by the faction color.

Color-Comparison.png rows: original, blue, green, purple, white. Individual previews exist for all four motions and colors. Preview PNGs are examples, not replacement artwork. Original assets and animation manifests are untouched. No live renderer integration has been made.

Built-in imagegen produced Fabric-Semantic-Guide.png using the source idle sheet: identify woven red cap crown, sleeves, and upper-back cloth in white; exclude fur, skin, leather, weapons, background and outlines in black; preserve the original layout. It identified the materials, but generated contours are approximate. The final masks use local source-pixel refinement rather than shipping those approximate contours directly.

build-masks.cjs reproduces masks and previews using Sharp. Its material selector and connected-panel cleanup are specific to this Clubman, not a universal fabric detector. Other units need independently identified material regions. Validation.json records dimensions, source-pixel hashes, and checks for unchanged alpha and byte-identical unmasked pixels. Visual review covered blue variants of every motion and all idle color variants. This remains a prototype for artistic review; black seams and the darkest boundaries intentionally remain uncolored.

Run from any directory with Node: node <absolute path to build-masks.cjs>. Set CLUBMAN_IMAGE_LIB to a Sharp module path if the bundled default differs.
