import { eraPortrait } from "./EraArtwork";
import { icon } from "./HudView";
import type { RecruitmentQueueViewModel } from "./RecruitmentQueueViewModel";

export class RecruitmentQueueView {
  private readonly cells = new Map<string, HTMLElement>();
  constructor(
    private readonly root: HTMLElement,
    app: HTMLElement,
  ) {
    new ResizeObserver(() =>
      app.style.setProperty(
        "--recruitment-feed-height",
        `${root.hidden ? 0 : root.offsetHeight}px`,
      ),
    ).observe(root);
  }
  update(vm: RecruitmentQueueViewModel): void {
    const keys = new Set(vm.entries.map((e) => e.key));
    for (const [key, cell] of this.cells)
      if (!keys.has(key)) {
        cell.remove();
        this.cells.delete(key);
      }
    this.root.hidden = !vm.entries.length;
    for (const entry of vm.entries) {
      let cell = this.cells.get(entry.key);
      if (!cell) {
        cell = document.createElement("div");
        cell.className = "recruitment-cell";
        const artwork =
          entry.kind === "fighter" || entry.kind === "bomber"
            ? eraPortrait(entry.kind)
            : undefined;
        cell.innerHTML =
          (entry.kind === "fighter" || entry.kind === "bomber"
            ? artwork
              ? `<img class="hud-art" src="${artwork}" alt="">`
              : `<span class="command-symbol">${entry.kind === "fighter" ? "F" : "B"}</span>`
            : icon(entry.kind, entry.definitionId)) +
          '<span class="recruitment-count"></span><div class="recruitment-progress" role="progressbar"><i></i></div>';
        cell
          .querySelector("[role=progressbar]")!
          .setAttribute("aria-valuemin", "0");
        cell
          .querySelector("[role=progressbar]")!
          .setAttribute("aria-valuemax", "100");
        this.root.append(cell);
        this.cells.set(entry.key, cell);
      }
      cell.title = `${entry.name}: ${entry.count} queued · ${entry.seconds === null ? "Waiting for producer" : entry.seconds === 0 ? "Training complete; waiting for deployment" : `Next in ${entry.seconds}s (game time)`}`;
      cell.querySelector(".recruitment-count")!.textContent = String(
        entry.count,
      );
      const bar = cell.querySelector<HTMLElement>("[role=progressbar]")!;
      bar.setAttribute("aria-label", cell.title);
      bar.setAttribute(
        "aria-valuenow",
        String(Math.round(entry.progress * 100)),
      );
      bar.querySelector<HTMLElement>("i")!.style.width =
        `${entry.progress * 100}%`;
    }
  }
}
