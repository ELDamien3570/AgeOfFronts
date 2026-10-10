# AI spending and progression hotfix

The capped-delivery economy shipped at `185be868658490d876f302551321e65eae42a439`
reduced revenue without adapting expansion policy and progression prices.
Positive trade revenue caused repeated producer construction even with unsold
goods, while optional infrastructure outranked advancement.

## Changes

- Factory/port trade expansion needs a profitable completed trip with no unsold
  cargo, existing producers below ten goods in total, and spare trader capacity.
  Revenue alone cannot justify more production. Ports no longer scale with the
  number of factories or unconditionally request another port after a profitable
  voyage. First ports and the second isolated-faction port remain available.
- Excess factory stock and returned land cargo justify additional receiving
  cities only while goods production exceeds existing city receiving capacity.
  Existing military-production prerequisites remain independent of trade growth.
- Safe factions with a standing force prioritize useful research over optional
  expansion. Viable advancement outranks optional growth and third-tree research.
  Research/advancement use committed reservations lasting up to ten minutes,
  still abandoning invalid or stalled goals. Refitting cannot consume their
  decision slot; emergency recruitment can preempt them. Production prerequisites
  needed to make the force viable retain precedence.
- Post-Stone technology prices are one-third of previous prices, rounded up.
  Age-up prices are 3,000 / 18,750 / 27,500 / 40,000 / 57,500 / 82,500 gold.
  Research durations and 35–60 second advancement durations remain unchanged.
  The cheapest complete Bronze tree pair plus Classical advancement now costs
  40,754 gold instead of 122,250, before other spending. The same paid rules apply
  to humans, nations and tribes, with existing technology-speed discounts.
- Cargo limits, receiving recovery, foreign premiums and sea risk remain as
  released. No additional path searches or per-tick market budget updates.

## Evidence and limits

`tests/skirmish/AiEconomyHotfixDiagnostics.json` records immutable-baseline versus
hotfix runs using the existing full `pacingAutoplay` simulation: four AI factions,
two seeds, a coastal 240×160 synthetic map, Bronze start, normal paid economy,
33 minutes or victory. Both retain exact checkpoint continuation after 30 ticks.

| Seed | Baseline | Hotfix | Build command attempts |
| --- | --- | --- | --- |
| 47 | Victory at 23.6 min, every faction Bronze | Victory at 26.8 min, winner Early Medieval | 48 → 37 |
| 72 | At 33 min, survivors Classical / Early Medieval | At 33 min, survivors Early Medieval / Late Medieval / Late Medieval | 100 → 41 |

These are progression regression scenarios, not a promise of a specific campaign
duration on a large geographic map. They start in Bronze rather than Stone.
Timing ran alongside release checks and is unsuitable as a performance comparison.
Focused regressions cover producer starvation versus market saturation, research
selection, protected saving through restoration, emergency recruitment, payment
and technology-speed scaling.

Release checks: 212 test files / 1,496 tests passed, TypeScript and scoped lint
passed, production build passed. Local two-client Bronze multiplayer smoke passed
with text/binary state agreement, reconnect, construction, trade controls and
movement from all ten AI factions.

Reproduce on the revision under review:

```powershell
node scripts/buildAiPacingDiagnostics.mjs current
node out/ai-pacing-current.mjs current 39600
```

Build the baseline bundle at the baseline revision before checking out the hotfix,
and retain it unchanged for comparison. Refresh the application and start a new
skirmish to use the hotfix; an already running browser worker keeps its loaded code.
