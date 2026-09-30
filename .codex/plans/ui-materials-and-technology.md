# Materials and technology UI integration

Status: design proposal, September 30, 2026. This pass reviews the current interface and specifies integration; it does not implement the gameplay systems or their UI.

Confirmed direction from this review: use a separate resource strip at the top, directly beneath the match controls. The remaining panel layouts and controls below are proposals.

Selected concept layout: **Battlefield drawer**. Continue its compact technology drawer while retaining the battlefield and left selection card; army creation/commands belong in selection controls and the army card, rather than a second broad technology panel. Exact dimensions and integrated behaviour still require UI implementation and review.

Related plans: [technology and cultures](tech-tree-and-cultures.md), [resources and weapons](strategic-resources.md), [pacing and recruitment](pacing-and-opening.md), [trade](trade-and-economy.md), and [diplomacy](diplomacy-and-alliances.md).

City/manpower direction: show current reserves and growth separately from fielded strength. City technology unlocks an individual paid upgrade in the selected city's left card, with actual tier/output, price, eligibility, and proposed job progress. Classical Urban Planning unlocks the first substantial growth improvement; research does not upgrade every city. See [manpower and city upgrades](<optimization and ai improvement/manpower-and-city-upgrades.md>). Medieval plague indicators depend on a later agreed event model.

## Recommended layout

Keep the battlefield central, the existing command dock for immediate actions, and the left card for the selected unit/building. Move economic stock information into a compact strip beneath the header. Open Technology and Supplies as separate, mutually exclusive panels; neither replaces the selected-unit model or changes the army selection.

Do not append every material and building to the existing bottom dock. Its compact layout already consumes substantial battlefield height. Research is an empire action, while upgrading a selected formation is a tactical action; those need distinct surfaces.

| Surface          | Purpose                                   | Proposed content                                                                                                                       |
| ---------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Header           | Match identity and session controls       | Culture, actual empire age, Technology access, clock/speed/pause/fit; match setup behind New skirmish.                                 |
| Resource strip   | Frequent financial/supply decisions       | Gold, reserve troops, unlocked strategic materials, Supplies access; resource shortage for the action currently being inspected.       |
| Left card        | Selected entity and its immediate actions | Current definition, health/orders, Upgrade action with exact costs; producer jobs or node ownership when those entities are inspected. |
| Bottom dock      | Build, recruit, and give orders           | Existing familiar categories, tier choice for recruitment, expanded building flyouts, control groups.                                  |
| Technology panel | Empire progression                        | Age browsing, three current-age trees, active research, node details, and paid/timed advancement.                                      |
| Supplies panel   | Production detail                         | Materials, equipment, production jobs, and access to commercial trade detail; separate inventories.                                    |

The first choice is a battlefield drawer, leaving tactical context visible on a wide screen. A wide overview is an alternative for deliberate planning, especially at smaller widths. Both use the same progression state and selections.

## Current interface evidence

Source review and local browser inspection were performed at 1280x720 and 850x720. These observations establish the current layout, not future-system behaviour or balance.

- [main.ts](../../src/skirmish/client/main.ts) creates a top header with map/opponent/world-size setup controls, time controls, battlefield canvas, overlays, and the HUD. It also writes several resource totals and button states directly in `updateHud()`.
- [HudView.ts](../../src/skirmish/client/HudView.ts) owns the bottom command dock, left selection card, mixed-selection inspection, tooltips, and Controls/Factions popovers. The dock currently groups Economy, Military buildings, Troops, Ships, and Orders.
- [HudViewModel.ts](../../src/skirmish/client/HudViewModel.ts) projects selection and tooltips. It groups same-kind entities, caches static cards by the existing small kind set, and displays prototype gold-income rates for factories/ports.
- [SkirmishViewModel.ts](../../src/skirmish/client/SkirmishViewModel.ts) selects a matching recruitment building and exposes availability. Its current land costs check reserves, not researched definitions or equipment stocks.
- [style.css](../../src/skirmish/client/style.css) provides the established dark naval palette, gold/teal accents, illustrated command buttons, an up-to-1112px dock, and a 282px desktop selection card. The card shrinks at breakpoints and scrolls internally.
- At 1280x720, the selected four-infantry card already needed scrolling. Upgrade and its blocking reason must not be buried below that scrolling content.
- At 850x720, the header wrapped to 100px high. The dock measured about 287px high inside a 597px battlefield area. The CSS hides the age badge below 1000px and secondary totals below 850px. Preserve age/research access at every supported width.
- [Controls.ts](../../src/skirmish/client/Controls.ts) assigns Q/W/E to recruitment, A/S/D/F/G/H to construction, T/B to ships, R to replenishment, X to hold, digits to control groups, Space to pause, and Home to fit. T is already Transport.
- [Renderer.ts](../../src/skirmish/client/Renderer.ts) currently reserves only bottom HUD height for map fitting. Changing that height calls `home()`, resetting the camera. Dynamic panels must not make the camera jump whenever they open or a value wraps.
- [BuildingArtwork.ts](../../src/skirmish/client/BuildingArtwork.ts) and HUD portraits currently select Stone Age artwork by broad kind. Age/culture definitions require a richer presentation lookup.

The existing snapshot-driven ViewModels and entity inspection are good integration points. Direct DOM updates, hard-coded kinds, and global hotkey handling are the specific areas to extend; there is no reason to introduce a second UI framework for these features.

## Resource strip and Supplies

Move Gold and Reserve troops out of the bottom resource row into the new header strip. Move Troops in field, squad limit, land, and losses into a compact battlefield summary/Factions detail rather than duplicating them in both places. This exchanges an existing resource row for the new strip instead of simply adding permanent height.

Show the strategic outputs Horses, Stone, Bronze, Iron, Steel, Gunpowder, and Oil as they become relevant. Keep their order stable. An unlocked zero stock remains visible. A retained older material remains reachable after advancement; shortage of iron must not hide bronze equipment or its production recipes.

At opening, provide a clear Horses unlock affordance leading to Horsemanship; future oil/steel icons need not fill the main strip. Supplies can show the complete progression with locked-state explanations. The user confirmed mining remains independent of Horsemanship; the horse unlock need not block the rest of the resource strip.

On wide screens, display all relevant strategic outputs that fit at readable size. On narrower screens, keep Gold/Reserves and action-relevant materials visible, with every remaining stock one click away in Supplies. Never solve density by shrinking labels below a useful size or silently dropping access to older materials.

Resource buttons show a distinct symbol, text label, and available quantity. Hover/focus can add exact totals, reserved input, production/consumption information, and the unlock technology. Essential identity and shortages remain visible without hover. Compact number formatting must not round affordability upwards; costs and detailed balances expose exact integers.

Supplies has distinct sections:

1. **Materials:** available/committed quantities, mine/stable/rig production, and refining jobs. Raw recipe inputs belong here rather than adding every ore to the permanent strip.
2. **Equipment:** weapon stocks by authored recipe/type and age, compatible troop definitions, and blacksmith/arms-factory production. Do not sum incompatible weapons into one spendable Weapons total.
3. **Production:** producer status, required inputs, job progress, missing supply, and an inspect/focus action for owned producers.
4. **Trade:** commercial batches, in-transit cargo, stops, recent settled gold, and captured-return status. Cargo is not strategic material or weapon stock.

Resource links navigate into this panel or focus the associated research/producer. Whether inputs use a player ledger or physical military logistics is still a domain decision; the UI cannot invent automatic weapon deliveries.

Display income from completed commercial deliveries. A recent delivered-income average may be useful if clearly labelled; do not retain the current port's guaranteed +12 gold/sec statistic after trader income replaces it. Factory passive income is still an open design decision and must follow the resolved ruleset.

## Technology panel

Use an empire-level Technology button with the actual age and counted-node totals from the resolved content: for example Naval 1/4, Warfare 3/5, Economic 4/4 in Bronze. Bronze Warfare includes Armies; every other current draft tree has four nodes. The summary always refers to the current empire age, even while browsing older or future research.

Desktop layout:

1. Header: culture identity, actual empire age, close action, and active research summary.
2. Age navigation: all seven authored ages; mark current, older available catch-up, and future locked content distinctly.
3. Three columns: Naval, Warfare, Economic. Show counted completion, active job, and the resolved node graph with prerequisite connections, including the fifth Bronze Warfare branch.
4. Selected-node detail: capability effects, prerequisites, exact gold cost/time, and a labelled Research action or specific blocking reasons.
5. Pinned advancement area: complete-any-two requirement, next-age cost/time, Advance Age action, or advancement progress.

Show one age's trees at a time; an 85-node screen would obscure the decisions. Within a usual tree, display foundation, both branches, and final technology without suggesting that one branch requires the other. Both branches feed the final node. Bronze Armies is a separate branch from Bronze Equipment, and 5/5 Warfare completion includes it even though Fortified Settlements itself still requires only Bowcraft/Chariot Warfare.

Use explicit node states: Starting grant, Completed, Available, Researching, Waiting in queue if supported, Missing prerequisite, Insufficient gold, and Future age. Text/icons supplement colour. Starting Flint Weapons and Settlements count as completed nodes and require no research purchase.

Research requires gold and time. The detail must distinguish **research unlocks a capability** from **deployment still needs a building, materials, or equipment**. A shortage of weapons must not make gold-only research appear to require those weapons. Research unlocks do not automatically upgrade existing units.

Each tree has its accepted separate research queue. Display its current job and remaining simulation time; queue length/cancellation/refunds remain unresolved. Do not add working cancel/refund controls until that policy is authored.

Current-age completion is computed from the culture's resolved technology IDs. When any two counted trees finish, advancement becomes eligible but still requires its gold fee and timer. For the first transition, show the confirmed 50,000 gold and 30-45-second range using the eventual configured value; the current draft proposes 40 seconds. Gold shortage keeps the action disabled with an explicit amount missing.

Browsing an older age exposes unfinished third-tree research, subject to the agreed catch-up graph. Future ages can be inspected without permitting purchase. A research job remains associated with its authored age if the empire advances. The panel keeps the actual empire age separate from the inspected age.

Use selected-node capability links to show where the unlocked building appears, its produced equipment, or the relevant recruitment/refit action. These links navigate only; they do not construct a building or buy a technology without an explicit action.

## Recruitment and the left Upgrade action

Retain Q/W/E as troop-line access. Give each line a visible tier-choice affordance with the chosen definition and age; clicking the main action recruits that chosen definition. A small selector opens researched older/newer definitions with cost and eligibility. Do not replace the chosen tier automatically when affordability changes.

Older unlocked troop types remain selectable after advancement. For example, if iron is unavailable, a player with reserves and bronze weapons can explicitly recruit bronze infantry. Its old recipe remains intact; the UI must not demand iron simply because the empire is Classical. An empty raw-material stock does not imply an empty finished-weapon stock.

Stone troop definitions have no manufactured-weapon requirement. Mounted Stone cavalry still costs horses. Subsequent mounted cavalry requires its own weapons and horses at every empire age. Tanks replace horses with manufactured armament plus steel/oil and reserves, as confirmed. Show the armament item and structural/fuel inputs separately.

Recruitment and upgrade cost blocks show each required item as required versus available, plus a short blocking reason. Do not show a material fee on recruitment when that material is already consumed upstream to make the required weapon, unless the authored recipe explicitly also requires it. Keep gold research costs, troop reserves, weapons, horses, and tank steel/oil distinguishable.

Pin Upgrade in a left-card action footer outside the stat scrolling area. Show current -> target definition, the agreed cost/time, and its eligibility. Researching a new troop type leaves the selected existing unit unchanged until the explicit upgrade command succeeds.

For a single focused unit, label the action for that unit. For a compatible selected group, show the target count and aggregate cost. If mixed selections contain different ages/cultures or incompatible refits, expose eligible groups explicitly; never upgrade all selected IDs because the user was only inspecting one cell. No silent affordable-subset purchase. Batch refit policy still needs agreement.

Grouping must use actual unit definition/tier and effective presentation, not only the current infantry/archer/cavalry kind. Two infantry squads with different equipment must not share a falsely uniform statistic or upgrade target.

The selected card continues to show the entity's actual art and capabilities. Empire age does not change older troops' portraits. Upgrade previews use target-definition art; completed refits update the actual entity.

Show Melee/Ranged Armour, Melee/Ranged Attack, Range and Reload Time for the actual selected definition, plus Charge Speed/Damage/Reload on charge-capable troops. Show the seven-level promotion icon and XP progress. The Upgrade preview explicitly warns that promotion resets to recruit on successful refit. Research previews show baseline definitions, not a falsely promoted new recruit. See [combat and promotions](combat-and-promotions.md) for triggered-charge input and domain rules.

Siege/projectile/bomb details also show Projectile Size and Blast Radius as distinct world-space values. Use Not applicable for contact or hitscan profiles. Visual sprite size and explosion duration never substitute for those domain values.

## Organized army selection and squad capacity

After Bronze Armies, multi-selection exposes Create Army with eligible squad count and the researched cap, initially 20 formations. Add a dedicated army icon and compact owned-army list that select the actual members in one click. Keep client control groups available earlier; they do not grant domain march bonuses. The left army card shows members/cap, actual strength versus combined definition capacities, role mix, march/deployment state, formation/facing, manual tactics and the automatic-tactics toggle.

Ordinary squad cards show current/max strength for their actual unit tier, not a global 1,000 meter or the faction's newest age. Upgrade preview shows the new capacity and that extra capacity needs real replenishment; no free HP. Include gunpowder accuracy/context and reload separately from armour and attack damage. Early Modern weapons must visibly communicate their inaccurate, slow-firing profile rather than suggest continuous reliable DPS.

Domain snapshots own membership and legal capabilities; ViewModels format eligibility/actions. Marker clicks and keyboard selection use stable army/member IDs, while individual override/detach remains explicit. Proposed army-symbol style, route/cohesion states, order precedence and responsive behaviour are specified in [armies and squad sizes](<optimization and ai improvement/armies-formations-and-squad-sizes.md>). Dedicated army artwork is still needed.

## Modern defence and launcher cards

The Modern build palette exposes gun nests/trenches under Fortifications after Combined Arms, retaining inspection of existing older walls. Anti-air vehicles appear as a labelled support choice in the military recruitment palette, with Aircraft only displayed as their target role. Do not place them behind a requirement to own aircraft or label them Missile defence.

Strategic Weapons exposes the fixed MIRV building and mobile MIRV unit as distinct choices. Their left cards separate launcher construction/recruitment, stored/required payload, launch eligibility and cooldown; the mobile card also shows movement/deployment state once those policies are authored. A researched unlock does not mean a launcher already has a free missile. Launch controls require explicit target preview and command validation, without copying the selection Upgrade action into an instant attack.

Trench previews/cards should show actual placement, access/cover and occupancy policy; gun-nest cards show weapon/target capability. Show blocking versus cover in the placement overlay according to the domain model. MIRV target/spread previews use authored warhead/blast geometry and visibility, not an arbitrary circle inferred from art. See [Modern rules](modern-defences-and-strategic-weapons.md).

## Producers, resource nodes, and construction access

Extend the same left inspection card to horse nodes/deposits, mines, stables, refining factories, blacksmiths, arms factories, and rigs. Show owner, resource type, production/job state, inputs, outputs, and specific waiting reasons. Stable cards show horse output and researched breeding improvement; weapon producers show equipment recipes, including retained older recipes.

For cities/ports, show commercial delivery activity and access to trade detail. A captured ship's prize return is displayed against a reachable owned port; captured land traders use owned cities. Captured cargo is not instantly credited at interception.

Keep common build shortcuts visible, but add labelled More/flyouts within existing building categories for the expanded roster. Group choices by player task such as Settlement/trade, Extraction, Equipment production, and Fortifications. UI grouping need not equal the research tree that unlocks a building. Do not add a permanent dock slot for every mine, rig, smith, tower, gate, and siege facility.

Locked build choices identify their research and offer Show technology. Available choices show exact placement/construction costs. The existing placement preview expands to deposit compatibility, rigs/coast, and tower-link/wall/gate previews under the separate fortification rules. Stone/Bronze/Classical previews use the verified cardinal wall/tower kit at matching scale/pivots; they must show valid domain connections and missing cross-tier/gate capability rather than infer blocking from PNG pixels.

Resource-node map symbols use their own IDs and an inspectable overlay, not terrain colour or a building kind shortcut. A resource layer toggle and focus-from-Supplies are proposals. Their visible content follows whatever map visibility policy is eventually chosen.

## Input, focus, and responsive behaviour

Proposed unused shortcuts: Y for Technology, I for Supplies, and U for the currently displayed eligible Upgrade action. T remains Transport. These are proposals, not implemented bindings.

Opening Technology/Supplies preserves selection, orders, camera, placement cancellation state, and the other panel's inspected item. Opening an overlay alone does not pause the simulation. For local play, Pause remains explicit; later multiplayer cannot promise a pause on research inspection.

Use one panel coordinator for Technology, Supplies, Controls, Factions, and future Diplomacy, extending the existing popover handling. Permit only one broad inspection panel at a time. Small tooltips remain separate. Escape closes the top panel first, then inspection/placement according to explicit priority; it must not clear army selection incidentally.

While a panel or native input has keyboard focus, suppress battlefield recruitment/build/group hotkeys. Enter/Space activate the focused control instead of also pausing, recruiting, or placing a building. Restore focus to the opener on close. Closed panels leave the accessibility tree; genuine modal sheets trap focus, while nonmodal desktop drawers must not pretend to be modal.

| Available width                     | Proposed adaptation                                                                                                                                                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1280px and wider                    | Three-column Technology drawer, compact node detail beneath it, left tactical card and command dock remain usable.                                                                                                                                         |
| Roughly 1000-1279px                 | Larger overlay above the dock; preserve selection internally even if the panel temporarily covers the left card.                                                                                                                                           |
| Around the current 850px breakpoint | Full-width Technology sheet with one tree at a time and persistent three-tree completion summary; compact build/recruit categories replace the tall all-actions grid.                                                                                      |
| Narrow/mobile                       | One inspection sheet at a time, readable resource summary plus Supplies access, accessible labelled controls, and the same exact costs/prerequisites. Touch command design needs validation rather than claiming that shrinking desktop buttons solves it. |

Exact breakpoints and dimensions are hypotheses. Validate 1280x720, 1024x768, 850x720, and 390x844, including longer culture names, large stock values, mixed selections, completed trees, and research in progress.

Panels use their own bounded scrolling on short desktop screens, with actions outside the scrolling details. Tooltips respect those bounds. Opening/closing panels must not trigger `Renderer.home()` or change simulation/navigation rules. Supply measured UI occlusion to Fit map deliberately; keep ordinary panel toggles from overwriting the player's camera.

Keep technology nodes compact: show identity and status in the tree, and exact costs/effects in the selected-node detail. Pin completion counts and advancement outside the scrolling node area. The accompanying concept expands content for review; it does not establish that the complete panel fits a 720px gameplay viewport without this scrolling design.

## MVVM and domain integration

No departure from MVVM or Domain-Driven Design is needed. Extend the existing interfaces with separate read models rather than putting the entire expansion into `main.ts` or `HudView`.

| Owner                            | Responsibility                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Progression domain               | Culture-resolved tree, completed grants/research, jobs, advancement eligibility, spending, and timers.                                |
| Economy/production domain        | Material and equipment ledgers, availability/commitments, producer recipes/jobs, horse costs, and recruitment/refit recipes.          |
| Application/worker boundary      | Research, advance, recruit selected definition, refit explicit entity IDs, and producer commands; revalidate and transact atomically. |
| Snapshot/read models             | Actual age/culture, stocks, jobs and timing, resolved capability IDs, entity definitions, and policy-derived eligibility reasons.     |
| Economy/Technology ViewModels    | Format stocks/costs, project the culture's trees and counted progress, and derive panel/queue detail from immutable snapshots.        |
| Recruitment/Selection ViewModels | Explicit selected tier, source building, exact recipe quote, upgrade target/count, and unavailable reasons.                           |
| Views/panel coordinator          | DOM, focus, hover, panel visibility, age browsing, and input routing. No local stock changes or authoritative research completion.    |
| Presentation catalog             | Art/icon/animation metadata keyed by definition, age, and culture; missing art has a readable fallback.                               |

Use shared, pure domain eligibility/cost policies for UI quotes where practical; do not maintain unrelated formulas in disabled buttons, tooltips, and worker validation. Commands can become invalid after a displayed quote; the worker rechecks current state and returns a specific rejection without partial spending. A requested older definition remains that definition throughout validation.

Separate browsed age, inspected entity, and chosen recruitment tier from match progression. Those are client presentation state. Technology jobs, inventory, unit refits, and completion are authoritative simulation state.

Current cached cards keyed only by broad kind must become definition-aware for static content, with current stock/eligibility/timers projected dynamically. Reuse DOM nodes where practical; preserve keyboard focus and selected-node identity across snapshots rather than replacing a whole research panel every tick. Gold/resource changes must not resize the HUD continuously or rebuild artwork.

Pin the content/ruleset version with the match. Future culture substitutions resolve from authored data; do not duplicate entire UI components or scatter Italian/American checks through views.

## Proposed implementation sequence

1. Establish domain definitions/read models for progression, recipe costs, materials/weapons, and explicit old/new troop choices. Keep unresolved refit/queue quantities and job policies explicit; tank input categories are settled.
2. Extract economy/resource projections from `main.ts` and add the resource strip, Supplies detail, and definition-aware recruitment costs/selection. Preserve current controls and command validation.
3. Add the Technology ViewModel/view, one-age tree display, prerequisite/research states, three queues, and paid/timed advancement.
4. Add pinned left-card Upgrade, compatible-group projection, and producer/node inspection. Expand building access through flyouts and placement capabilities.
5. Integrate panel/input/camera handling, current-age summary at compact widths, artwork lookup, notifications, and culture/setup identity.
6. Validate the integrated Stone/Bronze slice before extending the complete seven-age UI. Use real domain states and later authored recipes instead of shipping fixture prices as balance.

## Acceptance checks and open decisions

The UI must demonstrate:

- A building-free three-melee opening with Stone recruitment free of manufactured weapons and horse costs visible for mounted recruitment.
- Gold-only research quotes, counted starting grants, correct two-tree advancement eligibility, and no advance from merely browsing a future age.
- Timed jobs and age advancement through pause/speed changes, with completion awarded by domain state.
- Retained bronze recruitment when iron is unavailable, using bronze weapons; available equipment distinguished from raw stocks and commercial cargo.
- Mounted cavalry keeping horse costs in later empire ages; tanks showing manufactured armament, steel, oil and reserves.
- A selected squad staying unchanged after research until Upgrade succeeds; exact costs/reasons and no unintended mixed-selection refit.
- Mining, stable, weapon-production and trade interruption/shortage states, with completed deliveries distinguished from passive income.
- Keyboard and touch access to disabled-state reasons, panel focus restoration, Escape priority, no leaked battlefield shortcuts, and preserved selection/camera.
- Readable compact layouts with no missing age/research access, hidden required stock, clipped cost, or covered primary action.

Before implementation, settle queue cancellation/refunds, detailed weapon categories, producer logistics, and batch-refit policy. Those gaps do not prevent reviewing this layout proposal. Research duration/cost fixtures in an accompanying concept are illustrative, not approved balance or proof of a working simulation.

## Review validation

The current game was inspected at 1280x720 and 850x720. The accompanying interactive concept was checked for readable narrow navigation and horizontal overflow at 390px and 1024px, separate current versus browsed ages, research spending/timers, and distinct material/equipment stocks. A bronze recruitment example spent its stored bronze weapons and reserves while leaving raw bronze unchanged, with iron weapons at zero. These are concept checks, not tests of implemented gameplay; the integrated UI still needs the acceptance checks above.
