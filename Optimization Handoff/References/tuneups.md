# Tuneups: Age of Fronts Feature Fixes & Enhancements

This document outlines the detailed implementation plan for addressing three gameplay, UI, and visibility issues in Age of Fronts.

---

## 1. Issue 1: Cancel Recruitment One at a Time via Right-Click

### 1.1 Goal & User Experience
- In the top-left recruitment feed (`#recruitment-feed`), each unit type being queued displays an icon, count badge, and progress bar.
- Right-clicking on any recruitment cell cancels **one** queued unit of that type.
- It does **not** clear the whole queue, just one unit per right-click.
- The unit's recruitment cost (gold, reserve troops, and resource items) is refunded to the player in full.
- Standard RTS queue behavior:
  - If multiple units of that type are queued, the **most recently queued inactive unit** (tail of the queue) is cancelled first, leaving any unit already in training undisturbed.
  - If all queued units of that type are currently actively training (heads of different producer buildings), the one with the **least progress** (most remaining ticks) is cancelled and refunded.
- Right-clicking prevents the default browser context menu.
- A visual hint (`cursor: pointer` and tooltip mentioning `"Right-click to cancel 1"`) informs the player of the capability.

### 1.2 Protocol & Schema Changes
1. **`src/skirmish/Protocol.ts`**:
   Extend the `Command` union with `cancel-recruitment`:
   ```typescript
   | {
       type: "cancel-recruitment";
       playerId: number;
       category?: "land" | "ship" | "aircraft";
       definitionId?: string;
       kind?: string;
       buildingId?: number;
       buildingIds?: number[];
     }
   ```
2. **`src/skirmish/multiplayer/CommandSchema.ts`**:
   Add Zod validation for multiplayer synchronization:
   ```typescript
   command("cancel-recruitment", {
     category: z.enum(["land", "ship", "aircraft"]).optional(),
     definitionId: text.optional(),
     kind: text.optional(),
     buildingId: id.optional(),
     buildingIds: z.array(id).min(1).max(10_000).optional(),
   }),
   ```

### 1.3 Domain Logic: `src/skirmish/domain/Recruitment.ts`
Add a `cancel()` method to the `Recruitment` class:
```typescript
cancel(
  playerId: number,
  filter: {
    category?: RecruitmentJob["category"];
    definitionId?: string;
    kind?: string;
    buildingIds?: ReadonlySet<number>;
  },
  refund: (job: RecruitmentJob) => void,
): RecruitmentJob | undefined
```
Implementation details:
- Find all jobs belonging to `playerId`. If `buildingIds` is specified, filter by `buildingIds.has(job.buildingId)`. Filter by `category`, `definitionId`, and/or `kind`.
- Determine the active head job for each producer: the first job in `this.jobs` for each `buildingId` is the head.
- Separate candidates into **inactive queue jobs** (jobs queued behind the head) and **active head jobs**.
- **Pick target**:
  - Prefer the newest inactive candidate (iterate candidate list in reverse).
  - If all candidates are active heads, pick the candidate with `max(remainingTicks)` (least progress).
- Remove the chosen job from `this.jobs` and `this.ids`.
- Call `refund(job)`.
- Invoke all registered change listeners: `listener(job, false)`.
- Return the cancelled job.

### 1.4 Simulation Execution: `src/skirmish/Simulation.ts`
1. Handle `command.type === "cancel-recruitment"` in `executeCommand()`.
2. Invoke `this.recruitment.cancel()` passing:
   - `command.playerId`
   - Filter criteria (`category`, `definitionId`, `kind`, and set of `buildingIds` if present)
   - The refund callback that restores gold, reserves, and items to the player (mirroring lines 1231–1238 of `Simulation.ts`):
     ```typescript
     (job) => {
       const player = this.player(job.playerId)!;
       player.gold += job.cost.gold ?? 0;
       player.reserves += job.cost.reserves ?? 0;
       const inventory = this.expansion!.supply.inventories[player.id];
       for (const [item, quantity] of Object.entries(job.cost.items ?? {}))
         inventory[item] = (inventory[item] ?? 0) + quantity;
     }
     ```

### 1.5 Client View & UI: `src/skirmish/client/`
1. **`RecruitmentQueueView.ts`**:
   - Update constructor to accept an `onCancel?: (entry: RecruitmentQueueEntry) => void` handler.
   - When creating or updating each `.recruitment-cell`:
     - Add `cell.addEventListener("contextmenu", (e) => { e.preventDefault(); onCancel?.(entry); });`
     - Update tooltip text: `${entry.name}: ${entry.count} queued · Right-click to cancel 1 · ...`
2. **`src/skirmish/client/style.css`**:
   - Add `cursor: pointer;` and `user-select: none;` to `.recruitment-cell`.
3. **`src/skirmish/client/main.ts`**:
   - Pass an `onCancel` callback when initializing `recruitmentFeed`:
     ```typescript
     const recruitmentFeed = new RecruitmentQueueView(
       element("recruitment-feed"),
       element("app"),
       (entry) => {
         command({
           type: "cancel-recruitment",
           playerId: localPlayerId,
           category: entry.kind === "fighter" || entry.kind === "bomber" ? "aircraft" : ...
           definitionId: entry.definitionId,
           kind: entry.kind,
           buildingIds: renderer.selectedBuildings.size ? [...renderer.selectedBuildings] : undefined,
         });
       }
     );
     ```

---

## 2. Issue 2: Building Upgrades on Building Cards & 'U' Shortcut

### 2.1 Goal & User Experience
- When one or more buildings are selected, the building card (`#selection-card`) displays an **Upgrade button** inside `#refit-actions` (e.g. `Upgrade 1 Building to Bronze Age [U]` or `Upgrade 3 Buildings to Iron Age [U]`).
- Pressing `U` (or clicking the button) triggers the upgrade for all eligible selected buildings if an upgrade is available and affordable.
- The button is disabled with an explanatory reason if:
  - The building is already at the maximum available tier for the player.
  - The player has not researched the required technology for the next tier.
  - The player lacks sufficient gold or resource items.
  - The building is currently under construction or damaged.

### 2.2 Balance & Cost Design
1. **Cost Formula**:
   - Base cost: **50% of the target tier's full construction cost**.
   - Formula:
     ```typescript
     goldCost = Math.round(buildingCost(type, nextAge, existingCount).gold / 2);
     itemCost = Object.fromEntries(
       Object.entries(buildingCost(type, nextAge, existingCount).items ?? {}).map(
         ([item, qty]) => [item, Math.ceil(qty / 2)]
       )
     );
     ```
   - **Why this works**:
     - Building a new structure costs 100% gold and resources, increases the player's building count (which raises the +30% incremental building penalty via `buildingCostMultiplier`), and requires open territory.
     - Upgrading an existing structure costs only 50%, does *not* increase building count (sparing future placement penalties), and preserves base territory.
2. **Step-by-Step Tier Progression (Anti-Exploit)**:
   - Upgrades advance one age tier at a time (`StoneAge -> BronzeAge -> IronAge...`).
   - If a player enters Modern Age with a Stone Age barracks, they cannot jump from Stone Age directly to Modern for 525 gold. They must upgrade through the intermediate tiers or pay the step-by-step cost. This prevents cheap early-game spam from bypassing mid-game tech costs.
3. **Upgrade Construction Time**:
   - Upgrading takes 50% of the building's build ticks: `remainingTicks = Math.round(buildingTicks(type, existingCount) / 2)`.
   - While upgrading, the building cannot recruit or generate resources.
   - Prevents instantaneous health cheesing under attack.
4. **Health Scaling**:
   - Max health updates to `buildingIntegrity(type, targetAge)`.
   - Current health scales proportionally:
     `building.health = Math.max(1, Math.floor(newMaxHealth * (currentHealth / oldMaxHealth)))`.
5. **Retire Free Auto-Modernization**:
   - In `src/skirmish/domain/MilitaryInfrastructure.ts`, remove or disable `modernizeMilitaryBuildings()` from `Expansion.ts:beforeStep()`.
   - Previously, military buildings upgraded automatically for 0 gold upon researching warfare techs. Disabling this makes player upgrades intentional, rewarding strategic investment.

### 2.3 Protocol & Schema Changes
1. **`src/skirmish/Protocol.ts`**:
   Add `upgrade-building` command:
   ```typescript
   | {
       type: "upgrade-building";
       playerId: number;
       buildingIds: number[];
     }
   ```
2. **`src/skirmish/multiplayer/CommandSchema.ts`**:
   Add Zod schema:
   ```typescript
   command("upgrade-building", {
     buildingIds: ids,
   }),
   ```

### 2.4 Domain & Simulation Implementation
1. **`src/skirmish/content/Buildings.ts`**:
   Add helper functions:
   - `nextBuildingAge(type: BuildingType, currentAge: Age, playerAge: Age, completedTechs: readonly string[]): Age | null`
   - `buildingUpgradeCost(type: BuildingType, nextAge: Age, existingCount: number): Cost`
2. **`src/skirmish/domain/Expansion.ts`**:
   - Add `upgradeBuilding(player: Player, buildingId: number): string | null`
     - Validates ownership, tile control, intactness (`health > 0`), and idle status (`remainingTicks === 0`).
     - Determines `nextAge`.
     - Checks `progression.has(player.id, buildingTechnology(building.type, nextAge))`.
     - Validates and spends gold and items via `costRejection()` and `spend()`.
     - Updates `building.age = nextAge`, recalculates `maxHealth`, sets `remainingTicks` (if timed).
     - If tower, updates fortifications plan.
3. **`src/skirmish/Simulation.ts`**:
   - Handle `command.type === "upgrade-building"`: iterate `command.buildingIds` and apply upgrades.

### 2.5 Client UI & Shortcuts: `src/skirmish/client/`
1. **`EmpireViewModel.ts`**:
   - Add `buildingUpgrade(buildingIds: readonly number[])`:
     - Inspects selected buildings.
     - Computes eligible buildings, target age, total cost, and any rejection reason (e.g. "Max age reached", "Research Bronze Age Barracks first", "Insufficient gold").
2. **`EmpireView.ts`**:
   - In `update()`:
     - Check if `vm.selection.selectedBuildings` has items.
     - If so, call `vm.buildingUpgrade()` and render `#refit-actions`:
       ```html
       <button ${upgrade.reason ? "disabled" : ""}>
         Upgrade ${upgrade.count > 1 ? `${upgrade.count} Buildings` : "Building"} to ${upgrade.targetAgeName} <kbd>U</kbd>
       </button>
       <small>${upgrade.reason ?? `${fmt(upgrade.cost.gold)} gold`}</small>
       ```
   - In `upgrade()`:
     - Add branch: if buildings are selected, dispatch `command({ type: "upgrade-building", playerId, buildingIds })`.
3. **`main.ts`**:
   - Verify `KeyU` keydown handler routes to `empire.upgrade()` when buildings are selected.

---

## 3. Issue 3: Resource Node Visibility During Mine Placement

### 3.1 Goal & User Experience
- During normal gameplay, resource nodes are only visible if the player's age is greater than or equal to the resource's unlock age (`resourceVisibleAtAge(resource, playerAge)`).
- When selecting "Mine" (or oil structures) to place:
  - The map highlights valid placement tiles with green grid squares (`#9bffe066`).
  - **Only resource nodes that are visible in the player's current age** must be highlighted.
  - Undiscovered resource nodes (e.g. Iron or Coal while in the Stone Age) must remain hidden, without green highlight squares, and must not accept placement.
  - When the player advances to a new age, newly unlocked resource nodes immediately become visible and eligible for placement highlights.

### 3.2 Root Cause
- In `src/skirmish/client/PlacementPreview.ts:224-229`:
  `const node = this.resources.at(tile);` retrieves any deposit regardless of player age.
  `placement()` does not check `resourceVisibleAtAge(node.resource, playerAge)`.
- As a result, `sites()` returns future deposits as valid sites, and `Renderer.ts:976-992` draws highlight rectangles on them.
- Authoritative validation in `src/skirmish/domain/Expansion.ts:241-246` also lacks the age visibility check.

### 3.3 Proposed Fixes

1. **Client Placement Preview (`src/skirmish/client/PlacementPreview.ts`)**:
   - Import `resourceVisibleAtAge` from `../content/Resources`.
   - In `placement(type, tile)`:
     ```typescript
     const age = this.age ?? snapshot.expansion.progression[this.playerId].age;
     const node = this.resources.at(tile);
     const visible = node ? resourceVisibleAtAge(node.resource, age) : false;

     if (
       type === "mine" &&
       (!node || !visible || ["horses", "oil"].includes(node.resource))
     )
       return { reason: "Choose a mineral deposit", wallGold: 0 };

     if (
       ["oil-well", "oil-rig"].includes(type) &&
       (!node || !visible || node.resource !== "oil")
     )
       return { reason: "Choose an oil deposit", wallGold: 0 };
     ```
   - In `update(snapshot)`:
     - Include the player's age in the geometry cache key:
       `const playerAge = snapshot.expansion?.progression[this.playerId]?.age ?? "StoneAge";`
     - If `playerAge` changes, invalidate chunks so newly discovered resources immediately gain placement highlights.

2. **Authoritative Validation (`src/skirmish/domain/Expansion.ts`)**:
   - In `buildingSite(playerId, type, tile, age, ...)`:
     ```typescript
     const playerAge = this.progression.states[player.id].age;
     const node = this.supply.resourceSites.at(tile);
     const visible = node ? resourceVisibleAtAge(node.resource, playerAge) : false;

     if (
       type === "mine" &&
       (!node || !visible || node.resource === "horses" || node.resource === "oil")
     )
       return "Mines must be placed directly on a mineral deposit";

     if (
       (type === "oil-well" || type === "oil-rig") &&
       (!node || !visible || node.resource !== "oil")
     )
       return "Oil extraction needs an oil deposit";
     ```

---

## 4. Issue 4: Advanced Age Starts & Expanded Tribe Progression

### 4.1 Goal & User Requirements
1. **Advanced Age Starts**:
   - Rebalance starting gold, reserves, and inventories so that starting in any age mirrors the gameplay feel of the Stone Age start.
   - Players must begin with enough purchasing power to build:
     - 2 Cities of their starting age.
     - 1 Mine of their starting age.
     - 1 Smith / metalworking building of their starting age (`blacksmith`, `armory`, or `arms-factory`).
     - 1 Factory of their starting age.
     - 2 Barracks of their starting age.
     - Resources and gold to recruit a couple troops of that age (e.g. 2–3 frontline or ranged squads).
2. **Tribes in Advanced Age Starts**:
   - In any starting age setting, tribes must start in that same age (`startingAge`) with all prior technologies already unlocked.
   - Tribes can **research all technologies belonging to their starting age**, but **cannot advance beyond their starting age**.
   - Tribe building construction allowances:
     - Up to **1 of each economic/production building** available in that starting age (e.g. 1 city, 1 port, 1 factory, 1 mine, 1 smith/armory, 1 depot/oil-well).
     - Up to **2 of each military building** available in that starting age (e.g. 2 barracks, 2 archery ranges, 2 stables, 2 siege-workshops, 2 towers, 2 airstrips).
   - Tribes start with enough resources and gold scaled to their starting age to support building their allowed infrastructure and researching their age technologies.
   - Tribe AI (`thinkTribeDevelopment`) updated to actively construct and research according to these expanded rules.

### 4.2 Economy Math & Starting Resources by Age

In Age of Fronts, construction costs scale by `(1 + ageIndex)` (where `StoneAge = 0`, `BronzeAge = 1`, `ClassicalAge = 2`, `EarlyMedieval = 3`, `LateMedieval = 4`, `Industrial = 5`, `Modern = 6`). Building duplicate structures adds a +30% multiplier for each existing structure of that type.

#### Construction Gold Breakdown for the Standard Opening Package:
- **2 Cities**: `800 * (1 + ageIndex) + 800 * 1.3 * (1 + ageIndex) = 1,840 * (1 + ageIndex)`
- **2 Barracks**: `150 * (1 + ageIndex) + 150 * 1.3 * (1 + ageIndex) = 345 * (1 + ageIndex)`
- **1 Mine**: `400 * (1 + ageIndex)`
- **1 Factory**: `600 * (1 + ageIndex)`
- **1 Smith/Workshop**: `400 * (1 + ageIndex)`
- **Building Subtotal**: `3,585 * (1 + ageIndex)` gold
- **Troop Recruitment & Reserve Buffer**: ~1,500 – 3,000 gold plus reserve troops

#### Starting Gold, Reserves & Resource Inventory Matrix:

| Starting Age | Age Index | Starting Gold | Starting Reserves | Starting Resource Inventory |
|---|:---:|:---:|:---:|---|
| **Stone Age** | 0 | 4,000 | 6,000 | `stone: 60` |
| **Bronze Age** | 1 | 8,500 | 8,000 | `stone: 60, bronze: 40, copper: 30, tin: 30`, `equipment:bronzeage: 3` |
| **Classical Age** | 2 | 13,000 | 10,000 | `stone: 80, iron: 50, bronze: 30`, `equipment:classicalage: 3` |
| **Early Medieval** | 3 | 17,500 | 12,000 | `stone: 80, iron: 60, horses: 20`, `equipment:earlymedieval: 3` |
| **Late Medieval** | 4 | 22,000 | 14,000 | `stone: 100, steel: 60, iron: 40, gunpowder: 30, horses: 20`, `equipment:latemedieval: 3` |
| **Industrial** | 5 | 27,000 | 16,000 | `steel: 80, carbon: 50, gunpowder: 40, iron: 40`, `equipment:industrial: 3` |
| **Modern** | 6 | 32,000 | 18,000 | `steel: 100, oil: 60, carbon: 50, gunpowder: 50`, `equipment:modern: 3` |

### 4.3 Tribes Rebalance Specification

1. **Initial Age & Progression Initialization (`src/skirmish/domain/Expansion.ts`)**:
   - In `Expansion.add(player)`:
     ```typescript
     // Initialize progression to startingAge for all players including tribes:
     this.progression.add(player.id, this.startingAge);
     ```
   - Prior age technologies are automatically populated as completed for tribes, giving them the same technological baseline as regular players in that starting age.

2. **Starting Resources for Tribes (`src/skirmish/Simulation.ts`)**:
   - Tribe starting gold scales with age to cover their starting age roster (1 city + 1 port + 1 factory + 1 mine + 1 smith + 2 barracks + research):
     `tribeGold = Math.round(3,000 * (1 + ageIndex))`
   - Tribe starting reserves: `2,000 * (1 + ageIndex)`
   - Tribe starting inventory: receives a defensive supply bundle matching the starting age (enough to recruit their allowed 4 starting squads and build structures).
   - Starting barracks placed at the tribe base spawns with `age: this.startingAge`.

3. **Research Restrictions for Tribes (`src/skirmish/domain/Expansion.ts`)**:
   - In `command(player, command)`:
     ```typescript
     if (command.type === "advance-age" && player.kind === "tribe") {
       return "Tribes cannot advance beyond their starting age";
     }
     if (command.type === "research" && player.kind === "tribe") {
       const tech = TECHNOLOGY.get(command.technologyId);
       if (!tech || tech.age !== this.startingAge) {
         return "Tribes can only research technologies from their starting age";
       }
       return this.progression.research(player, command.technologyId);
     }
     ```

4. **Building Construction Limits for Tribes (`src/skirmish/Simulation.ts`)**:
   - Replace the legacy `1 city, 2 barracks` check with category-based validation:
     ```typescript
     if (player.kind === "tribe" && command.type === "build") {
       const startingAge = this.expansion?.startingAge ?? "StoneAge";
       const tech = buildingTechnology(command.buildingType, startingAge);
       if (!tech && command.buildingType !== "city" && command.buildingType !== "barracks") {
         return `Tribes cannot build ${BUILDING_RULES[command.buildingType].name} in this age`;
       }
       const own = this.buildings.filter(b => b.playerId === player.id);
       const isMilitary = [
         "barracks", "archery", "stables", "siege-workshop", "tower",
         "gun-nest", "trench", "missile-defence", "missile-silo", "mirv-launcher", "airstrip"
       ].includes(command.buildingType);

       const limit = isMilitary ? 2 : 1;
       const existing = own.filter(b => b.type === command.buildingType).length;
       if (existing >= limit) {
         return `Tribes can only build ${limit} ${BUILDING_RULES[command.buildingType].name}${limit > 1 ? "s" : ""}`;
       }
     }
     ```
   - Naval recruitment: Allow tribes with a port to recruit shore craft / transports if coastal.

5. **Tribe AI Behavior (`src/skirmish/domain/Expansion.ts:thinkTribeDevelopment`)**:
   - Update `thinkTribeDevelopment(player)` to prioritize:
     1. Researching available technologies within `this.startingAge`.
     2. Constructing up to 1 of each unlocked economic building (`city`, `factory`, `mine`, `blacksmith`/`armory`/`arms-factory`, `port`).
     3. Constructing up to 2 of each unlocked military building (`barracks`, `archery`, `stables`, `tower`, etc.).
     4. Recruiting troops up to their tribe squad cap.

---

## 5. Verification & Testing Plan

1. **Unit Tests (Vitest)**:
   - `tests/skirmish/Recruitment.test.ts`:
     - Test single unit cancellation: enqueue 3 archers, cancel 1, verify count is 2 and cost is refunded.
     - Test that cancelling does not reset active training progress when another unit of that type is waiting in queue.
     - Test cancelling the active training unit when it is the sole unit in queue.
   - `tests/skirmish/BuildingUpgrade.test.ts`:
     - Test upgrade availability across age tiers and prerequisites.
     - Test cost calculation (50% base, item halves).
     - Test rejection when tech is missing or player has insufficient funds.
     - Test health scaling and tier upgrade application.
   - `tests/skirmish/PlacementPreview.test.ts` & `tests/skirmish/DepositVisibility.test.ts`:
     - Test that Stone Age mine placement preview returns sites only for Stone deposits.
     - Test that advancing to Bronze Age dynamically unlocks Copper and Tin sites.
     - Test that placing a mine on an Iron deposit in Stone Age is authoritatively rejected.
   - `tests/skirmish/StartingAgeRebalance.test.ts`:
     - Verify starting gold, reserves, and inventories across all 7 ages for human/AI nations.
     - Verify player has enough funds and items to immediately place 2 cities, 1 mine, 1 smith, 1 factory, 2 barracks, and recruit squads in any starting age.
   - `tests/skirmish/TribeAdvancement.test.ts`:
     - Verify tribes initialize in match `startingAge` with prior technologies unlocked.
     - Verify tribes can research starting age technologies, but are rejected when attempting to research other ages or advance age.
     - Verify tribes can build up to 1 of each economic building and 2 of each military building available in `startingAge`.
2. **End-to-End Skirmish Verification**:
   - Run `npm run test:skirmish` to ensure all existing and new tests pass.
   - Run client preview via `npm run play`:
     - Start skirmish in Stone Age: verify queue right-click cancel, building upgrade button, and mine placement.
     - Start skirmish in Bronze Age & Industrial Age: verify starting resources allow immediate city, factory, mine, smith, barracks construction, and squad recruitment.
     - Observe AI tribes: verify they build their allowed infrastructure and research their starting age technologies.

