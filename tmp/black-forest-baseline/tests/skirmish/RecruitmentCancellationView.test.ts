// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { RecruitmentQueueView } from "../../src/skirmish/client/RecruitmentQueueView";
import type { RecruitmentQueueViewModel } from "../../src/skirmish/client/RecruitmentQueueViewModel";

it("right-click cancels one current feed entry and suppresses the browser menu", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  const root = document.createElement("div"), app = document.createElement("div"), cancel = vi.fn();
  const view = new RecruitmentQueueView(root, app, cancel);
  const entry = { key: "land:stoneage-infantry", category: "land" as const, kind: "infantry" as const,
    definitionId: "stoneage-infantry", name: "Infantry", count: 3, progress: 0.2, seconds: 4 };
  view.update({ entries: [entry] } as RecruitmentQueueViewModel);
  const next = { ...entry, count: 2 };
  view.update({ entries: [next] } as RecruitmentQueueViewModel);
  const event = new MouseEvent("contextmenu", { cancelable: true });
  root.firstElementChild!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(cancel).toHaveBeenCalledExactlyOnceWith(next);
  expect(root.firstElementChild!.getAttribute("title")).toContain("Right-click to cancel 1");
  vi.unstubAllGlobals();
});
