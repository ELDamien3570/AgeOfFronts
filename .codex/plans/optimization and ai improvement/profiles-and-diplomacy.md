# Profiles and diplomatic behaviour

Status: proposed personality system; existing alliance timing remains confirmed. September 30, 2026.

## Separate motivations from capability and skill

Culture selects tech/unit content once per match. Personality changes preferences. Difficulty controls permitted planning sophistication and reaction limits. Development stage gates capabilities. A Builder should still fight competently, and a Warlord should still maintain the economy needed to replace losses.

Profiles are authored data consumed by the shared strategy planner. Proposed trait weights use a normalized range and response curves rather than scattered faction-ID checks. Exact numerical presets require playtesting.

| Trait | Main effect |
| --- | --- |
| Aggression | Value of proactive warfare and contested expansion. |
| Economic ambition | Value of productive capacity, delivery income, and resource access. |
| Technology ambition | Value of capabilities/advancement relative to immediate force needs. |
| Opportunism | Value of temporary openings and weakened opponents. |
| Loyalty | Cost assigned to breaking commitments and abandoning relationships. |
| Ally assistance | Willingness to commit forces/resources to another faction's defence. |
| Risk tolerance | Required safety margin under uncertain enemy estimates and costly losses. |
| Diplomatic initiative | Willingness to seek partners and renew useful treaties. |

Loyalty and assistance are independent: a loyal faction may honour non-aggression while committing few reinforcements. A protective faction may sacrifice its own offensive opportunities to defend an ally. These differences should be visible in behaviour, not only a text label.

## Initial presets

| Preset | Expected choices |
| --- | --- |
| Warlord | Builds a replacement economy, prioritizes military throughput, secures strategic resources, and launches sustained attacks. Lower safety margins do not bypass retreat or path rules. |
| Builder | Expands trade and production, researches useful economic improvements, holds defensive armies, and attacks when needed to secure resources or remove a threat. |
| Opportunist | Watches weakness and overextension, develops an affordable strike force, negotiates useful alliances, and considers betrayal when gains justify the consequences. |
| Guardian | Values durable treaties, maintains reinforcement capacity, protects allied objectives, and gives credible defence missions priority over discretionary expansion. |

Preset names, public disclosure, and player customization are proposals. Use a stable profile ID and rules/content version. Any sampled variation is seeded at match creation; do not reroll a faction's loyalty every decision cycle.

## Relationship memory

Keep a bounded observer-to-faction relationship record: treaty history, observed aggression, honoured aid, abandonment, observed betrayal, delivery/trade interests where permitted, and last relevant event tick. The subjective trust score belongs to AI reasoning; the authoritative alliance state belongs to Diplomacy.

Decay old observations deliberately. Do not treat an unobserved event as known or infer trust from raw faction IDs. The live relation lookup handles legal protection; relationship memory explains whether the AI wants that protection.

## Offers, acceptance, and renewal

Evaluate candidate partners by common threats, useful geography, known force complement, trade opportunities, past conduct, personality, and victory mode. Use permitted exact allied counts or enemy estimates from the force knowledge adapter; do not consult hidden enemy production queues.

Offer, accept, reject, renew, and break through the same domain commands as the player. Preserve the confirmed offer timeout of 20 seconds, request cooldown of 30 seconds, five-minute term, final thirty-second mutual-renewal window, and thirty-second betrayal status. Domain eligibility and current configuration remain authoritative.

A loyal AI should be able to renew a useful alliance in Solo Victory. Allied Victory changes long-term utility, not whether renewal code is available at all. Both parties must consent; cached prior consent cannot extend treaties automatically forever.

Do not spam requests at every think cycle. Remember a rejection or outstanding offer until cooldown, expiry, or materially changed circumstances. Diplomatic initiative remains bounded by the same legal timers.

## Betrayal as an operation

An Opportunist evaluates expected territorial/production gain against known military strength, other threats, lost trade, relationship damage, uncertainty, and the configured faster-capture/weaker-wall penalty. It also needs an assembled force and reachable objective to exploit the opening.

Only a successful legal Break Alliance command changes hostility. Recheck relationships when attack orders and damage resolve; personality cannot bypass active treaty protection. Distinguish expiry/non-renewal from deliberate betrayal according to the existing diplomacy rules.

Commitment and cooldown prevent repeated switching between alliance and hostility. Preserve independent ownership and the existing prohibition on free resource transfers. Numerical betrayal coefficients remain tuning decisions in the [main diplomacy plan](../diplomacy-and-alliances.md).

## Guardian ally defence

1. Receive a permitted threat observation or aid request identifying the allied objective and attacker. An aid-request command/UI is an optional extension; automatic observed-attack response is the core proposal.
2. Confirm that the treaty is active, the objective is still relevant, and a legal reachable response exists.
3. Compare known threat severity, allied exact forces, travel time, available own armies, and home exposure.
4. Create or reprioritize a persistent defend-ally operation with a muster/reinforcement destination and completion condition.
5. Dispatch a useful force, reinforce losses, protect the threatened objective, and maintain the mission until the threat is resolved or a documented failure/relationship change occurs.

A strongly protective profile can postpone profitable offensives and accept greater losses to preserve the ally. It cannot create units, cross impassable routes, assume allied replenishment, or commandeer the ally's army. Plan own-territory resupply or rotation because allied services remain independently owned.

One skirmish near a border should not summon every army indefinitely. Coalesce threat events, assign mission strength according to severity, and release forces when the objective is safe. Idle defenders should have a return/recovery plan.

If the attacker is also an active ally, legal non-aggression still applies. Whether to mediate, decline aid, or legally break a treaty requires an authored policy; do not silently force betrayal through a Guardian label. Renewals, expiry, objective destruction, and withdrawal must reconcile an existing defence mission consistently.

## Intelligence and UI boundaries

Exact own/allied force counts and enemy estimates are confirmed. Personality calculations use the same enemy knowledge contract as player-facing strategic summaries. More difficult AI can interpret observations better; it should not obtain hidden exact forces by accidentally querying the authoritative index.

Profile identity or a public description may be shown in diplomacy if that disclosure is approved. Never expose private operation targets, betrayal scores, pending attacks, or internal decision trees in an enemy inspection payload. Debug inspection is a separate privileged tool.

## Validation

Use fixed seeds and matched starting conditions to compare presets. Look for economic investment, military production, attack frequency, alliance duration, betrayals, aid latency, forces committed to aid, ally survival, own survival, and scenario-specific objective outcomes.

All presets must bootstrap and recruit legally. Guardians must visibly protect a threatened ally; Opportunists must sometimes decline a tempting but unsafe betrayal; Builders must respond to invasion; Warlords must sustain replacements. Replacing hard-coded modulo rules with random behaviour alone does not meet these requirements.
