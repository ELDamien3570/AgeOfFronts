# Diplomacy and alliances

Status: design draft. Last updated: September 30, 2026.

Related documents: [the decision register](README.md), [technology](tech-tree-and-cultures.md), [trade](trade-and-economy.md), [fortifications](fortifications-and-siege.md), and [pacing](pacing-and-opening.md).

## Confirmed direction

- Diplomacy belongs in Age of Fronts.
- The player should be able to click another player's territory and offer an alliance to its owner.
- Alliances expire and require renewal.
- Whether allies can win together is a togglable game mode: support Solo Victory and Allied Victory.
- Use [OpenFront](https://github.com/openfrontio/OpenFrontIO) as a reference and use its alliance timing.
- Betrayal makes the betrayer's territory easier for enemy troops to capture and the betrayer's walls weaker.
- Keep allied resources, buildings, research, recruitment, replenishment, and other services independently owned initially.
- Configure Solo/Allied Victory at match setup, following the accepted proposal.

Baseline timing and independent ownership are settled below. Betrayal magnitudes, precise joint-win eligibility, and any future shared permissions still need explicit rules.

## OpenFront evidence and adaptation boundary

The public repository and its alliance source were reviewed on September 30, 2026. The checkout also contains inherited OpenFront code; the README identifies its imported base as `f372cdf9451cd8c3dc113aaaf8641e2609e2d3cb`. Browsed `main` pages may represent a different revision, so they are references rather than an assertion that local and current upstream files are identical.

Useful concepts verified in the source:

- [Alliance request execution](https://github.com/openfrontio/OpenFrontIO/blob/main/src/core/execution/alliance/AllianceRequestExecution.ts) creates an offer, recognises a reciprocal offer as acceptance, and expires unanswered requests. It also contains OpenFront-specific nuclear/embargo handling that does not establish requirements for this skirmish.
- [Alliance requests](https://github.com/openfrontio/OpenFrontIO/blob/main/src/core/game/AllianceRequestImpl.ts) are separate from active treaties and record proposer, recipient, creation tick, and response status.
- [Active alliances](https://github.com/openfrontio/OpenFrontIO/blob/main/src/core/game/AllianceImpl.ts) have an expiry and track each participant's agreement to extend. Renewal requires both participants.
- [The radial-menu actions](https://github.com/openfrontio/OpenFrontIO/blob/main/src/client/hud/layers/RadialMenuElements.ts) present request, extension, and break actions according to interaction eligibility.

The user requested OpenFront timing. Rechecked [upstream configuration](https://github.com/openfrontio/OpenFrontIO/blob/main/src/core/configuration/Config.ts) and the inherited local configuration on September 30, 2026:

| Setting               | Baseline duration           | At 20 skirmish ticks/second |
| --------------------- | --------------------------- | --------------------------- |
| Pending offer timeout | 20 seconds                  | 400 ticks                   |
| Offer cooldown        | 30 seconds                  | 600 ticks                   |
| Active alliance term  | 5 minutes                   | 6,000 ticks                 |
| Renewal prompt/window | Last 30 seconds of the term | 600 ticks                   |
| Betrayal status       | 30 seconds                  | 600 ticks                   |

These match the reviewed defaults. OpenFront's configurable alternate alliance lengths are not automatically adopted. Preserve durations in seconds and convert with skirmish timing; do not copy its raw ten-ticks-per-second constants.

The inherited implementation depends on OpenFront's `Game`/`Player` model. Do not attach the skirmish to `GameImpl` just to obtain alliances: that would introduce two gameplay authorities. Adapt the state-machine and interaction concepts into a skirmish diplomacy domain. Extract reusable code only where it is independent of those separate models.

## Territory-click interaction proposal

1. A deliberate click on another player's territory resolves its current owner and opens a player/diplomacy inspection panel.
2. The panel shows owner identity, culture/age when available, relationship, and eligible actions.
3. Offer Alliance submits a command to the domain. Clicking territory alone never creates an offer.
4. The proposer sees Pending. The recipient receives an in-game offer with Accept and Reject actions and remaining offer time.
5. Acceptance activates one bilateral treaty. Rejection or timeout clears the pending offer and exposes any cooldown.
6. An active alliance displays its remaining duration. Near expiry, either player can request renewal; the treaty extends only after both agree.

The clicked tile is an inspection entry point, not the alliance's identity. The treaty concerns two player IDs. Revalidate the selected owner when submitting an action; do not silently send an offer to a new owner after a tile changes hands.

Current controls use left click/drag for selection, right click for movement/attacks, and placement/landing modes for contextual actions. Recommended arbitration: placement and entity-selection gestures keep their existing meaning; a simple left click on otherwise unconsumed foreign territory opens diplomacy. Inspecting a player must not secretly issue army commands. Right click remains an order gesture.

A player-list inspection entry can provide access when no suitable territory is visible. Its inclusion is a proposed convenience, not a replacement for the required territory-click flow.

## Domain state proposal

Treat requests, alliances, and relationship policy as separate responsibilities:

- **Offer:** stable ID, proposer, recipient, creation/expiry ticks, and pending/accepted/rejected/expired/withdrawn status.
- **Alliance:** stable ID, two participants, activation/expiry ticks, and each participant's renewal consent for the current term.
- **Relationship policy:** answers whether a particular player may attack, capture, pass through territory, or use a shared service. These permissions are distinct.

Use one authoritative unordered participant pair for an active alliance. Multiple views may reference that treaty; they must not contain divergent mutable copies.

Alliances are bilateral and non-transitive. If A is allied with B and B with C, A and C are not automatically allies. A coalition or federation would require an explicit additional design.

## Offer and renewal rules proposed

- Both participants must be distinct, present, and not eliminated; the match must still be active.
- No duplicate active alliance or duplicate pending offer for a pair.
- Only the intended recipient can accept or reject an offer. The proposer may withdraw it if that action is supported.
- An incoming offer presents Accept explicitly. If simultaneous reciprocal offers are supported, resolve them into one accepted treaty rather than two requests/treaties.
- Unanswered offers expire after 20 seconds. Apply the 30-second request cooldown consistently; diplomacy timers run on simulation ticks.
- A renewal does not require changing the player's culture, age, or technologies.
- Consent applies to one renewal term. Extending clears both consent flags so stale agreement cannot cause indefinite automatic renewals.
- If only one participant renews, the current treaty remains active until its existing expiry and then ends.
- Offers/treaties involving an eliminated participant are cleaned up. UI notifications follow domain state.

Recommend baseline offers and acceptance without a gold or technology requirement. Timed alliances introduce an ongoing diplomatic decision without forcing Economic research to access diplomacy. Future treaty types and culture effects are separate scope.

## Alliance effects proposed

| Area                       | Initial policy recommended                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Direct attacks             | Reject orders targeting active allies.                                                                                          |
| Automatic targeting        | Land units, warships, and future siege units exclude active allies.                                                             |
| Damage resolution          | Recheck current relationship when applying damage; an outdated target selection cannot bypass an accepted treaty.               |
| Territory capture          | Allied occupation does not take allied tiles or buildings. Clear incompatible pending capture claims on acceptance.             |
| Movement                   | Permit passage without changing ownership; movement alone grants no shared services.                                            |
| Buildings and recruitment  | Retain independent ownership and recruitment rights.                                                                            |
| Replenishment and boarding | Keep current own-territory/own-transport eligibility initially. Any allied service access needs a separate explicit permission. |
| Gold and research          | Remain independently owned. No technology sharing or automatic resource pooling.                                                |
| Civilian traders           | Receive allied capture/attack protection; foreign/allied deliveries use the trade plan without shared ownership.                |

Acceptance must also reconcile existing attack/pursuit and queued attack orders aimed at the new ally. Prevent both the human interface and AI from reissuing illegal orders. A hidden menu button alone is not diplomacy enforcement.

The current skirmish contains owner-inequality enemy checks in direct attack validation, targeting, AI, and territory pressure/capture. Replace those decisions with authoritative relationship policy during implementation. Do not convert every ownership comparison into an alliance check: ownership remains essential for construction, recruitment, resource spending, and independent progression.

## Expiry, breaking, and victory

Expiry and renewal use the confirmed five-minute term and last-thirty-second renewal window. Show the countdown and warn before protection ends. Expiry takes effect consistently for combat, territory capture, civilian interception, and trade category within a deterministic tick order.

Betrayal has a confirmed gameplay consequence. Proposed first breaking model: an explicit Break Alliance command ends protection immediately and marks the initiating player as a betrayer for the OpenFront-baseline 30 seconds. Normal expiry, a declined offer, or failure to renew does not count as betrayal.

During that window, enemy troops capture the betrayer's territory faster and enemy attacks weaken the betrayer's walls. Proposed initial tuning follows the reference coefficients where useful: capture time at 80% of normal; effective wall damage resistance at 50%. The durations are fixed by the timing decision; these adapted magnitudes remain proposals.

The current 30-tick capture duration would become 24 ticks under that proposed 80% rule. Do not copy OpenFront's territorial combat formula into the independent squad simulation. Wall resistance is a new skirmish effect, not an existing upstream wall implementation.

Apply a temporary modifier to wall damage rather than halving current integrity. It ends without restoring damage sustained. The penalty affects the betrayer as defender against eligible enemies, not only one border, and accepting a new alliance does not erase it. Repeated betrayals should refresh a bounded duration rather than multiply penalties indefinitely; that stacking rule is proposed.

The user confirmed that allied victory should be a togglable game mode. Provide two choices:

| Victory mode   | Required behaviour                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Solo Victory   | Alliances provide cooperation/protection but do not grant a shared win. There is one eventual winning player.                   |
| Allied Victory | A qualifying allied group can share a win. Precise group eligibility and any additional victory objective remain to be defined. |

Select the victory mode during match setup and pin it in configuration, eventual save state, and multiplayer/replay metadata. This setup direction was accepted. The default and joint-win eligibility remain undecided; mid-match switching is outside the agreed first setup model.

The current skirmish declares a winner only when one player survives and stores one numeric winner. Allied Victory requires an explicit result with a set of winning player IDs and a distinct draw outcome; do not pick an arbitrary representative winner. HUD, match completion, command rejection after completion, and later statistics must use the same result.

A connected chain of bilateral alliances is insufficient because its endpoints may be enemies. A complete pairwise alliance among surviving players is one possible qualifying condition; an explicit coalition is another. Do not infer a winner set from rendering clusters.

Also decide whether allying every surviving player is itself enough to win or whether an additional objective is required. Otherwise players could end an Allied Victory match immediately by exchanging offers at the start. That might be an intentional diplomatic victory, but it must be an explicit rule.

In Solo Victory mode, communicate that alliances do not guarantee a joint win. Remaining allies can continue cooperation until expiry or an agreed breaking mechanism returns them to competition; automatic forced betrayal is not specified. AI renewal policy needs to consider this endgame so it does not renew an unwinnable stalemate forever.

## AI, MVVM, and simulation integration

- The diplomacy domain owns offers, treaties, timers, renewal consent, and relationship permissions.
- Application commands cover offer, accept, reject, optional withdraw, renewal consent, and optional break. Human and AI callers share validation.
- AI needs deterministic decisions about incoming offers and renewal. Avoid automatically accepting every request: the user could otherwise neutralise every opponent immediately.
- AI policy can consider current relations, threats, geography, and relative strength; exact criteria are open. Behaviour must also avoid targeting allies and attempting to capture allied territory.
- Snapshots/read models expose pending offers, active treaties, expiry, renewal flags, and actionable reasons for ViewModels.
- A diplomacy ViewModel presents the selected player and actions; the view displays buttons/notifications. Neither creates a treaty locally or computes authoritative expiry.
- Later multiplayer must bind command ownership to authenticated player identity. Reconnect/replay state needs offers, cooldowns, alliances, consent, and the agreed winner representation; the current local worker is not proof that those integrations exist.

## First milestone and validation

Initial diplomacy belongs alongside the first two-age progression/trade milestone. It should demonstrate:

1. Clicking foreign territory and sending an offer to the inspected owner.
2. Recipient acceptance/rejection, offer timeout, duplicate prevention, and invalid-player rejection.
3. Active allied protection for direct orders, automatic attacks, damage, civilians, and territory/building capture.
4. Reconciliation of existing hostile orders and capture claims on acceptance.
5. Expiry and mutual renewal, with no extension from a single consent or stale prior-term consent.
6. Consistent UI and AI behaviour through the same commands.
7. Independent culture, research, gold/resources, buildings, recruitment, and replenishment after acceptance, with allied trade bonuses but no shared inventories.
8. Both victory modes: no joint win in Solo Victory, and the defined joint-win eligibility/result in Allied Victory.

Foreign/allied trade and military trader capture are now required by the updated trade plan. Further treaty types, gifts, shared vision/research, coalitions, chat, embargoes, and additional reputation systems remain separate decisions. The confirmed betrayal penalty does not automatically import every OpenFront diplomacy mechanic.
