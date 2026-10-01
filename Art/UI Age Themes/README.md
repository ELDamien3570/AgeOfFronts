# Age UI themes

Seven material themes are integrated into the production skirmish UI. Stone uses fractured fieldstone with deep recesses and chipped icon-frame edges. Shared material textures frame the resource strip, command dock, portraits, selection cards, technology and production panels, help and faction popovers, stock menus, tooltips, army panels, notices and loading/result overlays.

| Game age | Material |
| --- | --- |
| Stone Age | Rugged stone |
| Bronze Age | Bronze |
| Classical Age | Iron |
| Early Medieval | Shimmering steel |
| Late Medieval | Gold |
| Early Modern | Gunmetal |
| Modern | Army green |

## Production behavior

The HUD follows the local faction's **earned age** supplied by `EmpireViewModel`. Browsing a different technology age does not reskin the HUD. A completed advancement updates the material and announces the age once; the steel theme adds one brief glint. Reduced-motion preferences disable animation while keeping the announcement.

Building map-marker rims follow the **owning faction's earned age** in the existing snapshot. Construction age still selects the appropriate building artwork; faction color still fills the marker center. Material color is applied after faction tint. At 18px these markers use a simple two-tone rim; textured rims belong to the larger HUD frames. Unknown owners retain the original unthemed marker.

All seven themes reserve the same frame width. The empire popup has compact margins and a footer that leaves scrollable content above the command dock at the reviewed 1280x720 size. Health and selection colors retain their existing meanings.

The theme lives in the client presentation layer: `AgeUiTheme.ts` owns the immutable palette mapping, `AgeThemeView.ts` applies it from the view model, and `age-theme.css` styles native components. No domain command, protocol field or second progression authority was added. Existing painted portraits receive their frames dynamically, including new content.

## Icon kit

`icons/` contains **259 PNG masters and 259 editable SVGs**: 37 symbols per age, consisting of 21 buildings, 7 formations, 6 resource groups and 3 orders. Each master is 512x512; each age also has a 768x480 atlas with 96px cells. `age-icons.json` lists every symbol, frame and file.

The black silhouettes remain consistent across ages. Formation rectangles, siege circles and tall ship fields remain intact inside their HUD frames. These exported formation frames are UI assets; the game's world formation geometry was not replaced.

`icons/masks/` contains 37 shared tint masks. Apply faction color only where the mask is white, with grayscale pixels providing antialiasing weights. Black excludes the material rim and glyph. Multiplying the entire icon would incorrectly recolor its age material. SVGs retain separate `age-frame` and `faction-field` groups and embedded painted material images.

## Review

Start the normal project server with `npm run play`, then open:

- `http://127.0.0.1:9000/` - production game.
- `http://127.0.0.1:9000/Art/UI%20Age%20Themes/Runtime_Theme_Review.html` - real production views in an isolated fixture world; select all seven ages, set a rival independently, or advance through the real domain command. Fixture stocks and completion states are generous for visual review. This harness adds no debug controls to the game.
- `http://127.0.0.1:9000/Art/UI%20Age%20Themes/Icon_Age_Catalog.html` - all icon exports with faction, category and name controls.

`Age_UI_Proposal.html` preserves the earlier standalone proposal. The production review is the current implementation. `runtime-screenshots/` captures the reviewed themes, panels, catalog and live game.

## Sources and verification

- `themes.json`: authoritative material order and palette values.
- `generated/`: unchanged image-generation outputs. `stone-smooth-original.png` preserves the earlier stone surface; `stone.png` is the accepted rugged revision. `generated/sources.json` and `generation-prompts.json` record provenance.
- `materials/`: seven opaque 512px WebP surfaces, totaling 597,906 bytes. `Material_Validation.json` records file checks.
- `build-materials.cjs`: rebuilds the web surfaces from recorded generated sources.
- `build-age-icons.cjs`: assembles original vector glyphs and shared materials into framed exports and tint masks.
- `validate-age-icons.cjs`: checks all 259 PNG/SVG pairs, seven atlases, 37 masks and mask exclusion around the material rim.
- `verify-marker-rendering.cjs`: checks all 21 live marker glyphs across seven ages at pixel ratios 1 and 2 using lossless native canvas pixels. Centers match the original renderer; material rims remain independent of faction tint.
- `build-preview.cjs`: rebuilds the static proposal's marker modules and portrait paths.
- `Integration_Verification.json`, `Runtime_Browser_Checks.json`, `Catalog_Browser_Checks.json`, `Icon_File_Verification.json`, `Marker_Render_Verification.json`: current checks and practical limits. Browser captures are JPEG; lossless comparisons use native canvas output.

Build scripts use the installed Codex Node/Sharp runtime path recorded in their source. Run them from this folder or pass their full script path. Type checking, a production Vite build and 13 targeted presentation/marker tests pass. All seven ages were inspected through production components, and earned-age technology browsing was checked in the running game. A complete seven-age campaign was not played as part of this art/UI pass.
