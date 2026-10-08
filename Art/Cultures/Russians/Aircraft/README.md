# Russian / Soviet aircraft

Modern age WWII static drafts: Yakovlev Yak-3 fighter and Petlyakov Pe-8 heavy
bomber. Both face up in a perpendicular overhead view. Base artwork remains
under `Art/Aircraft Icons`; ship/trader art and cultural building masters are
preserved.

Each role retains the original generated v1 and corrected v2 under `SourceArt/`.
The selected v2 is exported to `Icon.png` by a uniform full-canvas resize to the
existing 627 square aircraft contract. Native sources are 1254 square RGBA.
The fighter correction fixes the edge-on propeller projection. The bomber
correction restores complete wings and a broader planform. Its native file has
six alpha=1 border specks, preserved in the source; no visible airframe is
clipped, and the normalized export has a completely clear eight-pixel guard.

These are model-inspired game sprites, not exact museum restorations. Wing
stars emphasize culture readability rather than reproducing a squadron paint
scheme. Prompts, research links, source/output hashes and superseded-draft
reasons are in `Generation-Manifest.json` and `Generation-Prompts.json`.

Run `python Art/Cultures/Russians/Aircraft/build-static.py` from the repository
root to export both drafts, audit unchanged earlier artwork and regenerate the
static inspection collage. `manifest.json` is consumed through the aviation
review's culture registry; aircraft remain separate from building catalogs.
The page includes 28 px parked and 42 px flight size studies from the current
aircraft presentation, plus an enlarged 64 px check.

Review: `/Building%20Icons/Aviation-Review.html?civ=russians` on the local art
server. Animation requires approval of these static masters. Match rendering
has not been changed or certified.

Review chronology: WWII aircraft are Early Modern. Former Modern source folders remain archived provenance; contemporary aircraft have not been authored.

## Approved animation work

All four aircraft have 20-frame Parked and Flight loops, 512 px frames in 5 by 4 sheets. Run `python build-animations.py` to rebuild. Edit `animation-rigs.json` for registered propeller/exhaust coordinates. Approved source PNGs stay intact; the rigid airframe never deforms. Propellers use shaft-correct edge-on motion; jets use visible pulsing blue-white exhaust plumes. Flight terrain scroll exists only in the inspector. These are animated review drafts, not match-runtime integration.
