import { AGE_NAMES, AGES, type Tree } from "../domain/Definitions";
import type { TechnologyViewModel } from "./TechnologyViewModel";
import { technologyDetails } from "./TechnologyDetails";

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
const fmt = (n: number) => n.toLocaleString("en-US");
const NODE_HEIGHT = 88;
const ROW_GAP = 14;
const ROW_STRIDE = NODE_HEIGHT + ROW_GAP;

export function technologyTreeMarkup(
  vm: TechnologyViewModel,
  inspected: string,
  activeTree: Tree,
  detailsExpanded = false,
): string {
  const trees = vm.trees,
    nodes = trees.flatMap((t) => t.nodes);
  const preferred = vm.tree(activeTree).nodes;
  const detail =
    nodes.find((n) => n.id === inspected) ??
    preferred.find((n) => !n.completed) ??
    preferred[0];
  return `<div class="technology-browser"><nav class="age-navigation" aria-label="Research age">${vm.ages.map(({ age, state }) => `<button data-age="${age}" data-age-state="${state}" aria-pressed="${age === vm.age}" title="${state === "future" ? "Future age · preview only" : state === "catch-up" ? "Older research remains available" : "Current empire age"}">${AGE_NAMES[AGES.indexOf(age)]}${state === "current" ? " •" : state === "future" ? " ◇" : ""}</button>`).join("")}</nav>
    <nav class="tree-navigation" aria-label="Research tree">${trees.map((t) => `<button data-tree="${t.tree}" aria-pressed="${activeTree === t.tree}">${t.tree} ${t.completed}/${t.total}</button>`).join("")}</nav>
    <div class="technology-tree-scroll"><div class="tech-columns">${trees
      .map((tree) => {
        const height =
          (Math.max(...tree.nodes.map((n) => n.row)) + 1) * ROW_STRIDE -
          ROW_GAP;
        const edges = tree.nodes
          .flatMap((n) =>
            n.prerequisites.map((id) => ({
              child: n,
              parent: tree.nodes.find((p) => p.id === id),
            })),
          )
          .filter((e) => e.parent);
        const x = (n: (typeof nodes)[number]) =>
          n.span === 2 ? 50 : n.column === 1 ? 24 : 76;
        return `<section class="technology-tree" data-active="${tree.tree === activeTree}" aria-label="${tree.tree} tree"><h3>${tree.tree} <small>${tree.completed}/${tree.total}</small></h3><p class="research-job">${tree.job ? `${escape(tree.job.name)} · ${tree.job.remaining}s${tree.job.age !== vm.age ? " · other age" : ""}` : "Queue available"}</p><div class="tech-graph" style="--tree-rows:${Math.max(...tree.nodes.map((n) => n.row)) + 1};--tree-node-height:${NODE_HEIGHT}px;--tree-row-gap:${ROW_GAP}px"><svg viewBox="0 0 100 ${height}" preserveAspectRatio="none" aria-hidden="true">${edges
          .map(({ child, parent: p }) => {
            const parent = p!,
              from = parent.row * ROW_STRIDE + NODE_HEIGHT,
              to = child.row * ROW_STRIDE;
            // A long organizational branch travels outside intervening node boxes.
            const path =
              child.row - parent.row > 1
                ? `M 94 ${from - NODE_HEIGHT / 2} H 99 V ${to + NODE_HEIGHT / 2} H 94`
                : `M ${x(parent)} ${from} V ${(from + to) / 2} H ${x(child)} V ${to}`;
            return `<path data-edge="${parent.id}:${child.id}" class="${parent.completed ? "complete" : ""}" d="${path}"/>`;
          })
          .join(
            "",
          )}</svg>${tree.nodes.map((n) => `<button class="tech-node ${n.progressionEndpoint ? "progression-endpoint" : ""} ${n.completed ? "complete" : n.researching ? "researching" : ""}" style="grid-row:${n.row + 1};grid-column:${n.column}/span ${n.span}" data-node="${n.id}" aria-pressed="${detail.id === n.id}" title="${escape(n.name)} · ${escape(n.status)} · ${fmt(n.gold)} gold · ${n.ticks / 20}s">${n.progressionEndpoint ? '<span class="tech-endpoint-star" role="img" aria-label="Main progression endpoint" title="Main progression endpoint · all research in this age’s branch still counts toward age-up">★</span>' : ""}<b>${escape(n.name)}</b><small>${escape(n.status)}</small></button>`).join("")}</div></section>`;
      })
      .join(
        "",
      )}</div></div></div><article class="technology-detail" data-detail-node="${detail.id}" data-expanded="${detailsExpanded}" aria-label="Selected technology"><header class="technology-detail-header"><h3>${escape(detail.name)}</h3><div class="technology-detail-actions"><button data-details-toggle aria-expanded="${detailsExpanded}" aria-controls="technology-detail-body">${detailsExpanded ? "Minimize ▴" : "Details ▾"}</button><button data-research="${detail.id}" ${detail.reason ? "disabled" : ""}>${detail.researching ? "Researching" : detail.completed ? "Completed" : `Research · ${fmt(detail.gold)} gold · ${detail.ticks / 20}s`}</button></div></header><div id="technology-detail-body" class="technology-detail-body" data-details-scroll tabindex="0" aria-label="Technology description and stats"><p class="technology-description">${escape(detail.description)}</p><div class="technology-detail-extra"><small>Base stats before research bonuses</small><ul class="technology-stats">${technologyDetails(detail).map(line => `<li>${escape(line)}</li>`).join("")}</ul><small>Requires: ${detail.prerequisites.map((id) => escape(vm.empire.technologyName(id))).join(", ") || "No prerequisites"}</small>${detail.reason ? `<p>${escape(detail.reason)}</p>` : ""}</div></div></article>`;
}
