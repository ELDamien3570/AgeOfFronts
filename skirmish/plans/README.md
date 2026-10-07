# Civilization technology plans

Open `/skirmish/technology-planner.html` with the local skirmish Vite server.
Choose a civilization and browse **All research** to see Naval, Warfare and
Economy side by side. Research runs downward in split/join graphs derived from
prerequisite links. **All ages** connects the seven ages; age buttons focus one.
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
Russian names beyond the confirmed choices are proposals. Heavy-cavalry and
anti-cavalry introduction ages remain undecided; do not infer availability from
a proposed name or an inherited research description.

Repository saves are available only through the local development endpoint.
The endpoint validates the complete document and uses a file revision to reject
stale-tab saves. Static builds read the bundled plan and support JSON exports;
they cannot write to the repository. Export a conflicting draft before reloading.
