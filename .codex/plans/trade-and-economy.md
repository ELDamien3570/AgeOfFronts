# Trade, cargo, and factory logistics

Status: design draft. Updated September 30, 2026.

Related plans: [technology](tech-tree-and-cultures.md), [resources](strategic-resources.md), [diplomacy](diplomacy-and-alliances.md), [fortifications](fortifications-and-siege.md), and [pacing](pacing-and-opening.md).

## Confirmed scope

- Factories automatically generate traders; traders have no recruitment cost.
- They carry factory goods to cities and ports. Only cities and ports are delivery endpoints.
- A factory load can be distributed across several delivery stops before returning.
- Trader capacity governs the load and the number of delivery stops it can supply; technology can improve it.
- Earn gold on completed deliveries, not continuously while a route is assigned.
- Foreign deliveries earn substantially more than domestic deliveries; allied deliveries earn more again.
- Enemy troops or ships must intercept traders to capture them. Entering foreign territory alone does not capture a trader.
- Captured land traders return to the captor's nearest city for money; captured trade ships cash out at the nearest reachable owned port.
- Commercial trader cargo is separate from the strategic materials consumed by blacksmiths and arms factories.
- Trade deliveries replace the old passive port income.
- The user will supply animated trader and trade-ship sprites.
- Allied players keep independent ownership, stockpiles, gold, and research.

These decisions replace the earlier owned-city-to-owned-city recruitment model. International trade, factory-generated traders, multi-stop loads, and capture are now part of the design, not deferred optional features.

## Economy roles and the prototype transition

The prototype has no trader, trade route, delivery, cargo, or capture state. Its completed port earns 12 gold per second regardless of traffic. That passive port payment is removed by the confirmed new direction.

Factories are commercial production origins, not final delivery destinations. Cities and ports receive commercial cargo. Strategic refining and the blacksmith/arms-factory weapon chain use separate inventories and schedules; commercial deliveries do not supply troop equipment. Material definitions are in the resource plan.

The existing factory also pays a flat 20 gold per second. The user explicitly replaced port income, not this factory payment. Recommend reviewing/removing the factory's passive gold when goods-based production is introduced so the same output is not paid once at the factory and again at delivery. That numerical transition is still a proposal.

## Automatic generation and lifecycle proposal

A completed, owned factory produces commercial goods on simulation ticks. It automatically creates or maintains a bounded set of free traders appropriate to unlocked capabilities. No player recruitment purchase or per-delivery gold charge is required.

Proposed first model: one active outbound land trader per factory, with researched increases in capacity or throughput before increasing fleet size. Exact per-factory/player caps and generation/replacement intervals are open.

A reusable trader loads a production batch, visits eligible cities/ports, and returns to its factory to reload. No cargo is created by travel itself. If there is no eligible destination or no goods, the actor waits visibly or generation pauses.

Factory capture/destruction must revoke the former owner's future production and dispatch. An in-flight load remains an explicit owned shipment until settled, captured, or invalidated; losing a factory cannot mint a duplicate copy of its goods.

Factory-generated sea traders need a launch location on navigable water. Recommend a factory-associated port that launches an automatically generated vessel under factory dispatch capacity. This preserves the requested factory origin while preventing ships spawning on land. The precise assignment and factory-to-port cargo transfer are not yet agreed.

## Origins, transfer points, and deliveries

| Location                  | Role                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| Factory/workshop          | Produces and loads goods; returning for another load pays no delivery income.             |
| City                      | Eligible final delivery stop, including domestic, foreign, and allied cities.             |
| Port                      | Eligible final delivery stop and potential maritime loading/transfer point.               |
| Mine/stable/resource node | Produces strategic supply according to its own rules; not a commercial drop-off endpoint. |
| Other building/open land  | Not a commercial drop-off endpoint.                                                       |

A port may act as a final sale or a transfer point, but each cargo allocation has one intended settlement. Goods transferred for onward shipping are not also cashed out and recreated as another free export. Explicit transshipment is a proposal; it is not established simply by reusing a port icon.

Land stops require reachable land access; ship stops require reachable water berths. A foreign destination does not need to share the trader owner's technologies or inventory. Receiving commercial goods does not grant access to another player's strategic stockpile.

## Capacity and multi-stop loads

Each shipment records its original quantity, remaining cargo, and allocations to named destination stops. Cargo conservation must hold across loading, partial delivery, capture, loss, and return.

A larger capacity permits more funded stops or larger allocations. It does not increase the number of stops by producing fresh cargo at each city. Propose a normal drop quantity and a maximum unique-stop count per route; choose those quantities during the balance pass.

Example with abstract units: a capacity of 30 and allocations of 10 allows three complete drops from one factory load. Each drop removes 10 from the load; the empty trader returns without further earnings. These numbers illustrate the rule, not production balance.

Research can improve carrying capacity, dispatch interval, loading time, movement, or route planning. Keep their effects separate and use an explicit stacking policy.

Recommend one visit per destination per shipment and deterministic stop selection. Owners can prefer domestic safety, foreign value, or allied trade. Whether routes are entirely automatic, editable, or use a destination-priority list remains open; automatic generation must not require repeated purchase clicks.

## Delivery settlement and bonuses

At departure, give the shipment and each cargo allocation stable IDs and a defined base quote. On a valid arrival, consume the delivered allocation and credit its owner exactly once.

Confirmed ordering of value is domestic < foreign non-allied < allied. Proposed initial modifiers for discussion are domestic 1x, foreign 2.5x, and allied 3.5x. Exact numbers are not approved balance. Use integer percentages/rational arithmetic in the simulation.

Foreign includes another player's city/port even without an alliance. Military interception creates the risk. Do not block all foreign deliveries merely because the old simulation treats every other owner as an enemy.

Recommend cargo quantity/value and a bounded route-distance factor as base inputs. Measure income per second and exposure as well as gold per delivery. Detours, waypoint loops, or crowd avoidance cannot inflate the quoted value.

Validate destination ownership and relation at settlement. Suggested policy: the allied bonus requires the alliance to be active both at departure and delivery; otherwise use the applicable lower category. The exact quotation policy remains to be agreed, but a last-second offer/expiry must not duplicate or retroactively invent cargo.

Only the trader owner earns the confirmed delivery gold. No automatic treasury pooling, resource donation, or payment from the recipient's gold account is implied by an allied destination. Host-side benefits are a separate design decision.

## Military interception and captured cargo

Interception requires an eligible enemy military actor to reach the capture conditions. Allies cannot capture each other's traders. Territory colour alone is insufficient.

Capture is an authoritative event that:

1. Invalidates all unsettled original delivery allocations.
2. Transfers custody/ownership of the captured actor and remaining goods to the captor.
3. Clears its former stop list and commercial orders.
4. Assigns an automatic return to the captor's nearest reachable city for land traders, or nearest reachable owned port for captured trade ships.
5. Pays the captor once only when return succeeds.

Nearest means reachable navigation distance, with deterministic ties, rather than choosing an inaccessible city by straight-line distance.

Captured trade ships settle their prize at the nearest reachable owned port, as confirmed. No inland city leg is required. If no eligible port is reachable, do not award immediate capture gold; waiting/replanning, later port availability, and scuttling policy remain open.

Propose a prize value based on remaining cargo, without allied/foreign commercial multipliers. Already delivered cargo cannot be paid again. Empty traders should not yield a lucrative fixed chassis bounty because factories create them for free.

After prize settlement, recommend retiring the captured actor or moving it into a separately defined owned-service role. It must not keep returning to the original factory and collecting free goods under the captor's ownership.

Capture range/duration, competing captors, whether recapture is allowed, and destruction versus capture behaviour are still to be authored. The same shipment must never fund both original deliveries and prize settlement, even if capture and arrival occur in one tick.

## Free generation needs throughput limits

No recruitment cost does not mean unlimited instantaneous generation. Bound factory goods production, active traders, loading, and replacement timing.

Losing/capturing a trader must not instantly regenerate its full cargo at the source. Replacements use the normal production/dispatch schedule. Otherwise two non-allied players could farm free trader prizes faster than factories produce goods.

Compare ally trading and enemy capture against the one-hour progression budget. Alliances intentionally improve returns, but a domestic economy must remain viable and an allied pair should not multiply every phase into trivial savings.

## Interruption and navigation

- Stopping or blocking a trader pauses income; no payment occurs before arrival.
- Reassignment preserves cargo quantities or explicitly returns/discards allocations. It cannot create another fully loaded shipment.
- Destination loss, destruction, or an inaccessible berth invalidates or replans that allocation according to a defined policy.
- Factory loss stops future dispatch; outstanding cargo needs explicit ownership rules.
- Trader loss/capture stops its original owner's pending income.
- Player elimination removes future generation and settlement eligibility.
- Allied expiry affects protection and payout category through diplomacy; it does not pool or erase player inventories.

Tower-linked walls and gates are part of trader navigation. A city enclosure must preserve a reachable delivery entrance. Trade must never pay across a wall merely because the actor is within the old capture/delivery radius.

## Research integration proposal

| Capability                               | Research direction                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| Factory goods and automatic land traders | Stone Economic: Craft Workshops                                                     |
| Early mining and stone supply            | Stone Economic: Stone Mining                                                        |
| More cargo/delivery stops                | Stone Economic: Goods Handling, with later packing/logistics improvements           |
| Sea-trader availability                  | Naval cargo-vessel unlocks; factory dispatch plus eligible port launch              |
| Better sea capacity/speed                | Hull, sailing, rigging, propulsion, cargo handling                                  |
| Better land delivery                     | Roads, carrying capacity, loading/dispatch, mechanised logistics                    |
| Foreign/allied value                     | Baseline confirmed destination modifiers; later technology effects must be explicit |

Basic trade need not wait for a separate Barter Networks recruitment unlock: factory completion generates traders. That replaces the earlier proposed city recruitment node.

## DDD and MVVM responsibilities

- **Factory production:** separate commercial goods batches and refining capabilities, with bounded commercial dispatch eligibility. Blacksmith/arms-factory weapon jobs do not generate commercial trader cargo.
- **Trade:** shipment allocations, stop planning, delivery validation, captured-return state, and exactly-once settlement.
- **Economy:** gold/inventory transactions with conservation and ownership.
- **Diplomacy/combat:** interception eligibility and allied protection.
- **Navigation/fortification policy:** traversable paths and delivery/capture access points.
- **Application commands:** owner requests for route priorities, stopping/reassignment, and military interception where applicable.
- **ViewModels:** factory throughput, cargo/capacity, stops, pending value, delivery history, capture status, and reasons an actor is waiting.
- **Views/art:** show civilian movement and loading; animation never awards gold or transfers ownership.

Do not disguise traders as combat squads or military troop transports. Resolve age/culture through typed definitions and modifiers rather than special-case names. Pin shipment IDs, quantities, relations/timing policy, and generation state in eventual save/replay state.

## Art, validation, and first milestone

Use stable animation metadata for age/culture variants, idle/travel and optional loading/unloading clips, facing, pivot, footprint, and frame timing. Trader and trade-vessel markers must be distinct from military transports.

The initial integrated milestone must demonstrate a factory auto-generating a free trader, a finite load paying at several city/port stops, domestic/foreign/allied values, military capture and successful prize return, port-income replacement, bounded replacement, and no duplicate cargo/gold.

Validate independent allied inventories, capture-versus-arrival ordering, wall/gate access, sea launch and berth constraints, route reassignment, ownership changes, AI parity, and independence from animation/render visibility.
