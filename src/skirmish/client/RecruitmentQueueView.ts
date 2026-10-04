import { eraPortrait } from "./EraArtwork";
import { icon } from "./HudView";
import type { RecruitmentQueueEntry, RecruitmentQueueViewModel } from "./RecruitmentQueueViewModel";

export class RecruitmentQueueView {
  private readonly cells = new Map<string, HTMLElement>();
  private readonly entries = new Map<string, RecruitmentQueueEntry>();
  constructor(
    private readonly root: HTMLElement,
    app: HTMLElement,
    private readonly onCancel?: (entry: RecruitmentQueueEntry) => void,
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
        this.entries.delete(key);
      }
    const hidden = !vm.entries.length;
    if (this.root.hidden !== hidden) this.root.hidden = hidden;
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
        cell.oncontextmenu = event => { event.preventDefault(); const current = this.entries.get(entry.key); if (current) this.onCancel?.(current); };
      }
      this.entries.set(entry.key, entry);
      const title = `${entry.name}: ${entry.count} queued · Right-click to cancel 1 · ${entry.seconds === null ? "Waiting for producer" : entry.seconds === 0 ? "Training complete; waiting for deployment" : `Next in ${entry.seconds}s (game time)`}`;
      if (cell.title !== title) cell.title = title;
      const count = cell.querySelector(".recruitment-count")!, text = String(entry.count);
      if (count.textContent !== text) count.textContent = text;
      const bar = cell.querySelector<HTMLElement>("[role=progressbar]")!;
      if (bar.getAttribute("aria-label") !== title) bar.setAttribute("aria-label", title);
      const value = String(Math.round(entry.progress * 100));
      if (bar.getAttribute("aria-valuenow") !== value) bar.setAttribute("aria-valuenow", value);
      const progress = bar.querySelector<HTMLElement>("i")!, width = `${entry.progress * 100}%`;
      if (progress.style.width !== width) progress.style.width = width;
    }
  }
}
