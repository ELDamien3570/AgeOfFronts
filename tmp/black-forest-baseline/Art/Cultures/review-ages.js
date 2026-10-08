// Art review chronology only. Gameplay age IDs and legacy source paths stay unchanged.
export const REVIEW_AGES = [
  ['StoneAge', 'Stone Age'], ['BronzeAge', 'Bronze Age'],
  ['ClassicalAge', 'Classical Age'], ['EarlyMedieval', 'Early Medieval'],
  ['LateMedieval', 'Late Medieval'], ['Napoleonic', 'Napoleonic'],
  ['EarlyModern', 'Early Modern'], ['Modern', 'Modern'],
];
export function reviewAsset(asset, culture) {
  const age = culture === 'base' && asset.age === 'EarlyModern' ? 'Napoleonic' : asset.age;
  return { ...asset, sourceAge: asset.age, age,
    ageLabel: REVIEW_AGES.find(([id]) => id === age)?.[1] || age };
}
export function legacyBaseAge(age) {
  return age === 'Napoleonic' ? 'EarlyModern' : age === 'EarlyModern' ? null : age;
}
