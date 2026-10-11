/** Layout only: normal player placement and resource rules remain available. */
export const CONTINENTS_THEME = Object.freeze({
  id: "continents",
  revision: 1,
  name: "Continents",
  /** Continents per map size; 1000 picks 4 or 5 from the seed. */
  continentCounts: { 250: [2, 2], 500: [3, 3], 1000: [4, 5], 2000: [6, 8] } as const,
  /** Target land share of the map taken by continents (islands are extra). */
  landShare: 0.62,
  smallIslandCounts: { 250: [3, 5], 500: [8, 12], 1000: [18, 26], 2000: [40, 56] } as const,
  smallIslandRadius: [5, 10] as const,
  islandPlacementAttempts: 4000,
  /** Minimum field margin between neighbouring landmasses, which opens a strait. */
  strait: 0.07,
  coastHarmonics: [
    [2, 0.2],
    [3, 0.17],
    [5, 0.11],
    [7, 0.06],
  ] as const,
  lakeCounts: { 250: [1, 2], 500: [2, 4], 1000: [5, 9], 2000: [10, 18] } as const,
  lakeRadiusRatio: [0.011, 0.026] as const,
  lakeMinimumInlandRatio: 0.045,
  mountainMinimumHeight: 1600,
  mountainMinimumSlope: 135,
  mountainMinimumShoreDistance: 6,
  /** Whittaker-style personalities. Temperature 0 = polar, 1 = tropical. */
  climates: {
    temperate: { weight: 3, temperature: [0.42, 0.58], moisture: [0.5, 0.7], forest: [0.45, 0.8] },
    boreal: { weight: 2, temperature: [0.2, 0.32], moisture: [0.5, 0.72], forest: [0.6, 0.9] },
    arctic: { weight: 1.6, temperature: [0.03, 0.14], moisture: [0.35, 0.6], forest: [0, 0.1] },
    desert: { weight: 2, temperature: [0.64, 0.86], moisture: [0.04, 0.18], forest: [0, 0.05] },
    savanna: { weight: 1.6, temperature: [0.7, 0.84], moisture: [0.3, 0.45], forest: [0.1, 0.3] },
    jungle: { weight: 1.6, temperature: [0.8, 0.95], moisture: [0.76, 0.95], forest: [0.85, 1] },
    steppe: { weight: 1.5, temperature: [0.4, 0.55], moisture: [0.24, 0.38], forest: [0.04, 0.2] },
    mediterranean: { weight: 1.5, temperature: [0.58, 0.7], moisture: [0.3, 0.46], forest: [0.2, 0.45] },
  } as const,
  /** Temperature change from a continent's north to its south edge. */
  latitudeSpread: 0.55,
  topography: {
    counts: {
      range: [0, 0],
      massif: [0, 0],
      plateau: [0, 0],
      basin: [0, 0],
      plain: [0, 0],
    },
    heights: {
      range: [0, 0],
      massif: [0, 0],
      plateau: [0, 0],
      basin: [0, 0],
      plain: [0, 0],
    },
    maximumHeight: 5800,
    widths: {
      range: [0.01, 0.04],
      massif: [0.04, 0.14],
      plateau: [0.04, 0.14],
      basin: [0.04, 0.14],
      plain: [0.04, 0.14],
    },
    rangeLength: [0.1, 0.4],
    rangeBend: 0.38,
    coastalBlend: [0.006, 0.065],
    focusBounds: [0.28, 0.28, 0.72, 0.72],
    focusFraction: 0,
  } as const,
  thermalErosion: { iterations: 2, talus: 100, rate: 0.035 },
  formation: {
    resolution: 250,
    erosionPasses: 4,
    streamPower: 38,
    spurHeight: 0.28,
    detail: { strength: 1.25, drainagePasses: 2, incision: 240 },
  },
  sea: { shelfWidthRatio: 0.035, maximumDepth: 4200 },
});
export type ContinentClimate = keyof typeof CONTINENTS_THEME.climates;
