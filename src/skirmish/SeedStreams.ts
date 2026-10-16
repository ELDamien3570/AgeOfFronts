/**
 * XOR salts that give each consumer of a match seed its own PRNG stream, so two
 * generators seeded from the same number never replay the same sequence
 * (R2-L6). Every value must be distinct from the others here and from the
 * inline salts in the map generators, which are 0x2b573c21 and 0x62bd1739
 * (Black Forest), 0x5a3c91e7 (Continents layout), 0x6b2d7e15 (Continents),
 * 0x472bf319 and 0x367cab29 (Migration layout), 0x29fa8371 (Migration),
 * 0x658fc731 (regional topography) and 0x437b951 (terrain formation).
 */
export const BLACK_FOREST_LAYOUT_SALT = 0x3c6ef372;
export const SPAWN_STREAM_SALT = 0x51ed270b;
/** The simulation PRNG is only checkpointed today; salting it changes checkpoint state, not play. */
export const SIMULATION_STREAM_SALT = 0x1b873593;
