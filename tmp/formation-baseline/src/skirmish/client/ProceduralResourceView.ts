import type { GameMap } from "../../core/game/GameMap";
import type { Deposit, Resource } from "../domain/Definitions";
import { DEPOSIT_RESOURCES } from "../domain/DepositGeneration";
import { resourceIcon } from "./ResourceIcon";

const labels: Partial<Record<Resource, string>> = {
  horses: "Horses",
  stone: "Stone",
  copper: "Copper",
  tin: "Tin",
  ironOre: "Iron ore",
  carbon: "Carbon",
  gunpowder: "Gunpowder",
  oil: "Oil",
};
const colours = [
  "#ead18e",
  "#e0e4df",
  "#f49c65",
  "#8ed8ed",
  "#d28b99",
  "#a0a6ac",
  "#dad17c",
  "#679ddd",
];

export function resourceLegend(deposits: readonly Deposit[]): string {
  return DEPOSIT_RESOURCES.map((resource, index) => {
    const count = deposits.filter((d) => d.resource === resource).length;
    return `<div style="display:flex;align-items:center;gap:7px"><span style="width:18px;height:18px;display:inline-block">${resourceIcon(resource)}</span><span style="color:${colours[index]}">${labels[resource]}</span><span style="margin-left:auto">${count}</span></div>`;
  }).join("");
}
export function resourceOptions(): string {
  return (
    '<option value="all">All resources</option>' +
    DEPOSIT_RESOURCES.map(
      (r) => `<option value="${r}">${labels[r]}</option>`,
    ).join("")
  );
}
export function drawResourceDeposits(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  deposits: readonly Deposit[],
  selection: string,
  scale: number,
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#101713";
  ctx.font = "11px system-ui";
  for (const deposit of deposits) {
    if (selection !== "all" && deposit.resource !== selection) continue;
    const x = ((deposit.tile % map.width()) + 0.5) * scale + offsetX,
      y = (Math.floor(deposit.tile / map.width()) + 0.5) * scale + offsetY;
    if (x < -10 || y < -10 || x > width + 10 || y > height + 10) continue;
    const radius = selection === "all" ? 3 : 4.5;
    ctx.fillStyle = colours[DEPOSIT_RESOURCES.indexOf(deposit.resource)];
    ctx.beginPath();
    if (deposit.resource === "horses") ctx.arc(x, y, radius, 0, Math.PI * 2);
    else {
      ctx.moveTo(x, y - radius);
      ctx.lineTo(x + radius, y);
      ctx.lineTo(x, y + radius);
      ctx.lineTo(x - radius, y);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
    if (scale >= 5) {
      const label = labels[deposit.resource]!;
      ctx.lineWidth = 3;
      ctx.strokeText(label, x + radius + 3, y + 4);
      ctx.fillText(label, x + radius + 3, y + 4);
      ctx.lineWidth = 1;
    }
  }
  ctx.restore();
}
