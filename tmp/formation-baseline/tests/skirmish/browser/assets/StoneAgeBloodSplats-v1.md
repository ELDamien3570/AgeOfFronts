# Stone Age blood splat atlas v1

Generated using the built-in `image_gen` tool with `transparent_background: true`.
Saved as `StoneAgeBloodSplats-v1.png`, 1254 x 1254 RGBA, with the generated alpha
preserved. The master was copied unchanged from the generated-images folder.
Runtime samples four 627 x 627 quadrants, selects deterministically per casualty,
and fits each decal into the previous ground-blood envelope. Blood fades separately
from its size and bodies. No external API or CLI image generation was used.

Final generation prompt:

> Use case: stylized-concept. Asset type: top-down 2D RTS ground blood decal sprite atlas. Generate one square transparent PNG atlas with exactly FOUR different dark crimson blood splats in a perfectly regular 2 by 2 grid, one centered splat per quadrant. Each decal completely contained within the middle 75 percent of its quadrant with transparent padding; no splatter crosses quadrant boundaries. Direct overhead view, flat on ground, no perspective. Organic irregular pooled blood, branching splash fingers, ragged wet edges, satellite droplets, nuanced dark burgundy red with sparse muted brighter red details. Hand-painted semi-realistic game art that reads clearly at 20 to 40 pixels. Four distinct silhouettes: a broad uneven pool, a diagonal directional splash, a compact jagged radial stain, an elongated smeared pool with droplets. Comparable visual scale and density in each quadrant. Only blood; no people, bodies, weapons, ground texture, text, labels, borders, grids, shadows, checkerboard, white backdrop, black backdrop or watermark. True transparent background between and around every splat. Keep each silhouette compact and richly interesting without becoming a firework pattern.
