# Civilization technology plans

Open `/skirmish/technology-planner.html` with the local skirmish Vite server.
Choose a civilization and browse **All research** to see Naval, Warfare and
Economy side by side. Research runs downward in split/join graphs derived from
prerequisite links. **All ages** connects the civilization's planned ages; age buttons focus one.
Select a research card to highlight its full prerequisite path and downstream
technologies. The dependency summary links to immediate parents and unlocks,
including technologies outside the current age or branch view.

Select **Edit selected node**, edit its fields and **Apply node edits**. The
inspector can be closed to give the diagram the full page width. Unit progression
cards open their editor directly.
**Save changes** writes `technology-plan.json` here. The page also supports JSON
import/export, undo/redo, civilization cloning, adding research and deleting nodes.

This is an authored development plan, not runtime content. The live game still
uses `src/skirmish/content/technologies.json` and its current unit definitions.
The future player-facing page can consume this versioned plan after approval;
runtime integration is a separate task.

Technology IDs are stable; `order` is display order and prerequisite IDs define
research dependency order. Nodes can move between ages and branches. Dependencies
must exist in the same civilization, cannot come from a later age, and must form
a directed acyclic graph. Unit prerequisites refer to technologies, and all are
required. Each civilization has at most one unit per role per age; a missing cell
can be added in the editor. Availability and decision status are independent.

Base records reflect existing content. The current unsplit cavalry/mobile line
is provisionally displayed in the light-cavalry lane, including its Modern tank.
Russian names beyond the confirmed choices are proposals. Anti-cavalry starts in Bronze Age; Russian heavy cavalry starts in Early Medieval. Do not infer availability from
a proposed name or an inherited research description.

Repository saves are available only through the local development endpoint.
The endpoint validates the complete document and uses a file revision to reject
stale-tab saves. Static builds read the bundled plan and support JSON exports;
they cannot write to the repository. Export a conflicting draft before reloading.

Version 2 stores an age list per civilization, research type (unlock, upgrade or capstone), gold cost and research seconds. Version 1 imports migrate while preserving authored edits. The separate Russians eight-age rework proposes Napoleonic, Early Modern (1914-1970) and present-day Modern, with individually researched upgrades and three terminal capstones. All added prices and effects are provisional; nuclear-powered submarines do not automatically imply nuclear missile armament. Capstones must be in the final age and cannot be prerequisites for other technologies. New civilizations cloned from this draft inherit its eight-age structure.

The Russian troop-only planning page is at /skirmish/troop-tree.html. It reads names and availability from this plan, omits unavailable nodes and draws class progression rather than research dependencies. Proposed gold, production seconds, same-era 0-100 stat ratings and specialist target bonuses come from src/skirmish/planning/TroopTreePlan.ts. Regular infantry is cheapest and fastest to train. Anti-cav starts in Bronze Age; Russian heavy cav starts in Early Medieval, peaks in Late Medieval and remains expensive. The view adds no runtime combat or production behavior.

## Normal skirmish migration (2026-10-07)

Normal skirmish now registers all 42 available Russian troops across eight runtime
ages, including separate Napoleonic, Early Modern and Modern eras. It uses authored
research prerequisites, prices and training times, with six recruitment classes and
the existing squad simulation/network model. Spear, heavy cavalry and ranged cavalry
have their own recruitment controls. See [RecruitmentMigration.md](RecruitmentMigration.md)
for implemented capabilities, provisional balance and explicit remaining boundaries.

Russian building, ship, aircraft, trader and animated gun-nest art is prepared into
bounded 128px runtime images. Source assets remain unchanged. Airstrips occupy 2x2
cells. Command previews, placement ghosts and tooltips use Russian building art;
42 ready actor sets provide matching recruitment portraits and individual world
rendering in normal skirmish. Tanks use one vehicle; trucks and APCs use staggered
or abreast pairs. The Cossack Lancer binding uses the accepted set in its legacy source folder.

The runtime research catalogue includes 259 supported nodes and the prerequisite
closure needed by recruitment and supported buildings. Existing economic/naval
baseline mechanics remain; unfinished drone, submarine, rail and facility mechanics
are unavailable. The saved eight-age planner remains the editable design source.

Balance reference pages used for the first pass:
[Archer](https://ageofempires.fandom.com/wiki/Archer_(Age_of_Empires_II)),
[Pikeman](https://ageofempires.fandom.com/wiki/Pikeman_(Age_of_Empires_II)),
[Knight](https://ageofempires.fandom.com/wiki/Knight_(Age_of_Empires_II)).
These inform the squad profiles; they are not literal transplanted AoE2 combat.

## Explicit Russian unlock review

The eight-age Russian draft has one named unlock per available troop, individual
siege-unit unlocks, and separate construction unlocks for each supported building
tier, including Russian art-only proposals. Palisades/walls and gates are split too.
`RussianExplicitUnlocks.ts` supplies the reviewed catalog for seed generation;
`technology-plan.json` retains the editable saved draft. Runtime readiness and effects are documented in RecruitmentMigration.md.
Bronze Spearmen are unlocked directly by Bronze Equipment; Bronze Barracks has its own construction unlock.
Research cards use current troop idle-frame art and building icons. Composite icons
on foundations show subjects they lead to; tooltips distinguish these from direct
unlocks. A selected troop links to its actual research node.

## Confirmed early troop unlocks

Empty Russian class cells represent unavailable classes, not free age-entry unlocks.
Available classes have explicit named research. Bronze Spearmen are the exception to
a separate troop node: completing Bronze Equipment unlocks them directly. Horse
Archers and Druzhina retain their named class unlocks. Saved and newly generated
Russian rework trees follow the same rule.

`scripts/compileRussianEarlyRoster.ts` exports the 24 available troops through Late
Medieval and their full prerequisite closure to `russian-early-roster.json`. It is a
review artifact, not registered runtime content. It preserves authored unlocks,
research prices, recruitment prices and training times; it rejects missing or
unpriced prerequisites rather than silently replacing them with legacy slots.
The full runtime roster is now compiled by compileRussianRecruitment.ts and registered in normal skirmish.
