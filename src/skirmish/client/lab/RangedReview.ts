import { FIXED, TICK_MS, type Snapshot } from "../../Protocol";
import { UNITS } from "../../content/Units";
import { formationDoctrine } from "../../domain/FormationGeometry";
import { eligibleShape } from "../../domain/FormationProfiles";
import {
  COMBAT_PRESENTATION_DELAY_TICKS,
  CombatPresentationTimeline,
} from "../CombatPresentationTimeline";
import { formationRenderPose } from "../FormationRenderPose";
import { RUSSIAN_TROOP_ACTORS } from "../troops/RussianTroopCatalogue";
import { TroopActors } from "../troops/TroopActors";
import { BattleLabModel } from "./BattleLabModel";

const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>("scene"),
  ctx = canvas.getContext("2d")!;
const unitSelect = el<HTMLSelectElement>("unit");
const units = UNITS.filter(
  (u) => RUSSIAN_TROOP_ACTORS.get(u.id)?.ranged && u.formationRecipe,
);
for (const unit of units)
  unitSelect.add(new Option(`${unit.name} · ${unit.age}`, unit.id));
unitSelect.value = "classicalage-rangedcavalry";
const timeline = new CombatPresentationTimeline(
  COMBAT_PRESENTATION_DELAY_TICKS,
);
let model: BattleLabModel, actors: TroopActors | undefined;
let clock = 0,
  paused = false,
  accumulator = 0,
  previous = performance.now(),
  generation = 0;
let presentedSource: Snapshot | undefined,
  stepsRequested = 0,
  sampledAt = 0;
let center = { x: 48, y: 48 };
let scale = 44;
const project = (x: number, y: number) => ({
  x: canvas.width / 2 + (x - center.x) * scale,
  y: canvas.height / 2 + (y - center.y) * scale,
});

async function restart() {
  const token = ++generation;
  actors = undefined;
  el("error").textContent = "";
  el("status").textContent = "Loading troop artwork…";
  try {
    const unit = units.find((u) => u.id === unitSelect.value)!;
    const count = Math.min(unit.formationRecipe!.capacity, 24);
    const doctrine = formationDoctrine(unit.id);
    const shape = eligibleShape(count, doctrine, doctrine.defaultShape);
    model = new BattleLabModel(
      ([1, 2] as const).map((side) => ({
        side,
        definitionId: unit.id,
        formations: 1,
        soldiers: count,
        variant: "base",
        shape,
      })),
      Number(el<HTMLSelectElement>("encounter").value),
    );
    model.controlledSide = 2;
    model.start();
    center = { x: 48, y: 48 };
    const troop = RUSSIAN_TROOP_ACTORS.get(unit.id)!;
    const next = new TroopActors(() => clock, {
      troops: [troop],
      byDefinitionId: new Map([[unit.id, troop]]),
      reformInPlace: true,
    });
    await next.load();
    if (token !== generation) return;
    actors = next;
    timeline.clear();
    timeline.update(structuredClone(model.game.snapshot()));
    presentedSource = undefined;
    clock = 0;
    accumulator = 0;
    sampledAt = 0;
    stepsRequested = 0;
    paused = false;
    el("pause").textContent = "Pause";
    previous = performance.now();
  } catch (error) {
    if (token === generation) el("error").textContent = String(error);
  }
}
el("restart").onclick = () => void restart();
unitSelect.onchange = () => void restart();
el("encounter").onchange = () => void restart();
el("pause").onclick = () => {
  paused = !paused;
  el("pause").textContent = paused ? "Play" : "Pause";
};
el("step").onclick = () => {
  paused = true;
  el("pause").textContent = "Play";
  stepsRequested++;
};
el("cancel").onclick = () => {
  const source = model.game.squads.find((s) => s.playerId === 1);
  if (!source) return;
  model.command({
    type: "order",
    playerId: 1,
    squadIds: [source.id],
    order: { type: "hold" },
  });
  model.attackNearest(1, [source.id]);
  timeline.update(structuredClone(model.game.snapshot()));
};

function frame(now: number) {
  requestAnimationFrame(frame);
  const delta = Math.min(100, now - previous);
  previous = now;
  if (!actors) return;
  const width = Math.round(canvas.clientWidth),
    height = Math.round(canvas.clientHeight);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const speed = Number(el<HTMLSelectElement>("speed").value);
  if (!paused) accumulator += delta * speed;
  let stepped = false;
  while ((accumulator >= TICK_MS || stepsRequested) && !model.finished) {
    if (stepsRequested) stepsRequested--;
    else accumulator -= TICK_MS;
    model.step();
    stepped = true;
    if (
      paused ||
      model.finished ||
      model.game.tick % Number(el<HTMLSelectElement>("spacing").value) === 0
    )
      timeline.update(structuredClone(model.game.snapshot()));
  }
  if (model.finished && stepped)
    timeline.update(structuredClone(model.game.snapshot()));
  if (model.finished) timeline.finish();
  if (paused && stepped) timeline.seekLatest();
  // Give an explicit tick-step an exact endpoint; otherwise use the game's
  // bounded presentation playhead, including the sparse-publication option.
  sampledAt += paused ? 0 : delta;
  const sampled = timeline.sample(sampledAt, speed, paused);
  if (!sampled) return;
  const focus = Number(el<HTMLSelectElement>("camera").value);
  const subject = sampled.snapshot.squads.find((s) => s.playerId === focus);
  center = subject
    ? { x: subject.x / FIXED, y: subject.y / FIXED }
    : { x: 48, y: 48 };
  scale = subject
    ? 110
    : Math.min(
        44,
        width / (Number(el<HTMLSelectElement>("encounter").value) + 8),
      );
  clock = sampled.tick * TICK_MS;
  if (sampled.source !== presentedSource) {
    actors.prune(sampled.snapshot);
    presentedSource = sampled.source;
  }
  actors.beginFrame();
  ctx.fillStyle = "#263329";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#324437";
  ctx.lineWidth = 1;
  for (let x = (width / 2) % scale; x < width; x += scale) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = (height / 2) % scale; y < height; y += scale) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  actors.drawRemains(ctx, scale, project, width, height);
  for (const squad of sampled.snapshot.squads) {
    const root = { x: squad.x / FIXED, y: squad.y / FIXED };
    const pose = formationRenderPose(squad, sampled.tick, root);
    actors.draw(
      ctx,
      squad,
      project(root.x, root.y),
      pose.geometry.angle,
      scale,
      sampled.tick,
      root,
      pose,
    );
  }
  actors.flush(ctx);
  for (const fact of sampled.snapshot.volleys)
    actors.drawVolley(ctx, fact, sampled.tick, scale, project, width, height);
  for (const projectile of sampled.snapshot.expansion?.projectiles ?? [])
    actors.drawProjectile(ctx, projectile, sampled.tick, scale, project);
  el("status").textContent =
    `${model.finished ? "Encounter ended · restart to replay" : paused ? "Paused" : "Playing"}   |   Simulation tick ${model.game.tick}   |   Display tick ${sampled.tick.toFixed(2)}\n` +
    sampled.snapshot.squads
      .map((s) => {
        const a = s.weaponState?.rangedAction;
        const phase =
          a && sampled.tick < a.releaseTick
            ? "PREPARING"
            : (a?.phase.toUpperCase() ?? "IDLE");
        return `${s.playerId === 1 ? "Blue" : "Red"}: ${s.troops} soldiers · ${phase}${a ? ` #${a.sequence} · prepare ${a.startTick} → release ${a.releaseTick}` : ""} · last shot ${s.weaponState?.ranged?.lastShotTick ?? s.lastAttackTick ?? "—"}`;
      })
      .join("\n");
}
void restart();
requestAnimationFrame(frame);
