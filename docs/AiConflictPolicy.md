# AI conflict and mineral development

Strategic choices use the existing command, diplomacy, production and route authorities. Missions reserve funds and assets; recruitment, construction, refits, theft and combat still commit through their normal handlers.

## Fleets and piracy

Fleet demand covers researched hull power needed for same-sea ports, coastal patrol sectors, exposed cargo and observed hostile ships. Personality changes the coverage goal. Paid construction, repairs and refits count toward future power. Useful minimum protection competes as committed spending; optional piracy remains growth spending. Investment credit limits reinvestment after losses.

Warship research also values planned fleet use during peace, including its prerequisites. Full fleets can modernize a safe obsolete hull through the paid `refit-ships` command. Refitting retains ready cover and does not interrupt active interceptions.

A read-only, bounded opportunity query can find neutral loaded merchants. It grants no permission itself. A ready force must retain coastal guards, meet escort strength and reach the interception before opening a raid through `Diplomacy.beginAiRaid`. Escort estimates are local to the convoy, and opportunity searches rotate through patrol sectors. A small extra raiding detachment must justify its marginal cost against observed cargo value. Alliances, start protection, peace protection and interception exemptions still apply. A raid opens the existing embargo relationship; an actual capture is a separate physical event.

## Paid military development

Peaceful connected rivals do not make a coastal nation geographically isolated.
A continuous mobilization quote uses current researched formation gold costs and
one quarter of liquid gold above protected research savings, capped by the
existing personality force share. It is a demand quote, never purchasing credit.
The same technology speed and already-paid progression jobs inform every caller.
A larger legal faction capacity cannot reduce the affordable target.

Ordinary demand continues rolling forward as troops and paid recruits accumulate;
locked roles redistribute their share to available core roles. Manpower demand
uses the intended formations' actual reserve costs. Additional city output counts
only after paid construction completes within the planning horizon. Missing
training producers and measured manpower shortages receive resumable search
turns within the existing eight exact placement checks, including sites beyond
the nearest page.

A bounded development pass can pay for deficit recruitment and measured
production, training or trade construction alongside ordinary research. Each
command rechecks current stock, ledger reservations, live force counts and the
research savings floor. Recruitment completion quotes share the authoritative
formation training duration and count existing paid queues. New jobs stay within
the five-minute readiness horizon; an authored formation longer than that may
still train alone. Newly completed producers can therefore receive unpaid demand
instead of leaving all future recruits queued at the oldest building. Missing
materials do not become hypothetical funds.

## Prepared land campaigns

Regular nations under `raids-v1` prepare explicit dominance, retaliation or mineral-acquisition objectives. Preparation feeds the existing recruitment and equipment demand. Available neutral land does not veto a credible paid preparation against another AI. Objectives beyond legal reinforcement capacity are reassessed. A declaration requires a certified route, a usable offensive force after the home reserve, readiness and credible matchup strength. Strategic field capacity matches the
existing bounded multi-detachment army controller, deducting home, defense,
screen and coastal commitments. It does not assume a whole faction must fit
inside one army.

Strategic comparisons use the authored weapons and current troops. A conservative opening-fire allowance accounts for range and closing speed; contact comparisons allocate a finite soldier budget between independent melee and ranged channels. Ongoing wars receive no hypothetical opening volleys. These are advisory estimates, not changes to combat damage or movement.

Progressing campaigns can continue beyond the former two-minute cutoff. Stalling, depletion and home defense still trigger reassessment; long campaigns periodically recheck their viability. Limited mineral objectives seek settlement once the site is usable and supported. Peace willingness considers actual military quality and the current bilateral objective.

## Mineral scarcity

Regular nations may construct up to ten mines per deposit, paying the existing rising construction costs. Regular economic AI considers useful legal unoccupied deposits of the same mineral first. It stacks only to repair a throughput shortfall in the funded downstream chain. Stacked construction is sequential and capacity forecasts include that delay. Tribes cannot stack any buildings. They may construct two mines per mineable resource across separate deposits, counting paid foundations toward the limit. Other economy and production facilities have a per-type limit of two in Stone Age, increasing by two each age; research unlocks still apply. Pure defensive buildings retain their existing limits. Captured or restored buildings above the limit remain intact, but prevent further construction of that type.

A completed economic decision can publish up to three persistent raw-mineral pressures. The quote distinguishes missing ore from insufficient refining, records simultaneous raw-input shortages, and includes actual paid jobs. Local expansion eligibility resumes under a bounded scan across decisions and checkpoints. Exhausted local remedies increase invasion motivation; a sustained but locally remediable shortage can influence an otherwise credible campaign's objective.

## Grievances

Actual merchant captures, attributable damage, territorial losses and betrayal can influence later choices. Each AI retains at most four rival grievances. Values are capped and decay lazily; repeated events are coalesced so one battle or a tile-capture wave does not flood the relationship state. Grievances bias priorities and never grant attack permission.

## Verification

`AiNavalRaids.test.ts` covers paid protection fleets, physical neutral convoy capture, patrol sentinels, protected targets and full-cap paid modernization. `AiMineralScarcity.test.ts` covers shared mine limits, free-site preference, sequential capacity, raw-material pressure and resumable local searches. `AiCampaignPolicy.test.ts` covers strategic readiness, campaign persistence, resources, peace and grievances. Combat contract tests remain independent of the strategic estimate.

`AiMobilization.test.ts` covers continuous treasury/capacity targets, speed and
paid progression jobs, unlocked role shares and exact manpower demand.
`AiParallelDevelopment.test.ts` covers paid concurrent development, live
resource/capacity/queue guards, placement beyond the nearest page and resumed
city/training search. `PortCargoStorage.test.ts` covers factory and port cargo,
physical dispatch spacing, per-tick fractions and legacy-save migration.
