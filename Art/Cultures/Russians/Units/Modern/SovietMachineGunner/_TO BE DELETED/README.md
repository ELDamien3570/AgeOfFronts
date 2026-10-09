# Soviet DP-28 Machine Gunner

WWII Soviet gunner under the Russian culture's Modern Age review. The overhead idle v2 was approved for animation. Steel helmet, khaki tunic, leather belt, canvas pan-magazine pouch and DP-28 held low in two hands.

Ten six-frame clips are available: idle, walk, burst fire, pan-magazine reload, get hit, get charged, charge running, advance-and-fire, side death and back death. Walking and charge share the corrected alternating gait with different playback cadence. Burst markers and weapon-state metadata are visual review references; runtime owns ammunition, projectiles and reload timing. The review shot/reload sequence demonstrates both actions without asserting that every burst empties a magazine.

Generation.json and SourceArt/Animation-Generation.json record built-in ImageGen prompts, references, native sources and superseded drafts. SourceArt/compose_animations.py registers whole poses using fixed clip scales and authored roots. Validation.json records 60 distinct frames, source-cell boundary checks, transparent baked guards and registered preview bounds. Original idle and approved master remain unchanged. Animation approval and runtime integration are pending. Do not rerun prepare_idle.py after animation registration.

Equipment reference: https://muzeum.swinoujscie.pl/katalog-zabytkow/katalog-zabytkow/bron-zespolowa/reczny-karabin-maszynowy-dp-28/

Idle-TopDown-v2.png is the current review frame: helmet crown and shoulder tops dominate, chest and legs are strongly foreshortened. Original idle remains preserved. SourceArt/TopDown-Correction.json records the built-in ImageGen camera edit. Alpha guards passed; local image and metadata returned HTTP 200. Browser rendering has not been independently verified.

