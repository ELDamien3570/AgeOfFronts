import {
  FIXED,
  type ArcherVolley,
  type Snapshot,
} from "../../../src/skirmish/Protocol";
import { demoSoldierCount } from "./DemoTroopPresentation";
import { DEMO_TROOP_BY_ID } from "./DemoTroops";
import { StoneAgeDemoActors } from "./StoneAgeDemoActors";
import type { ManualFormation } from "./TroopPrototypeModel";

/** Isolated, explicitly cosmetic inspection scene using the exact in-game actor pipeline. */
export class FormationManeuvers {
  readonly canvas = document.createElement("canvas");
  readonly controls = document.createElement("div");
  readonly actors = new StoneAgeDemoActors(() => this.time);
  visible = false;
  formation: ManualFormation = "line";
  private source?: Snapshot;
  private time = 0;
  private previous?: number;
  private paused = false;
  private direction = Math.PI / 2;
  private surrounded = false;
  private casualties = 0;
  private auto = false;
  private nextTurn = 4000;
  private error?: string;
  constructor(stage: HTMLElement) {
    this.canvas.style.cssText = "z-index:10;display:none";
    this.controls.style.cssText =
      "position:absolute;left:12px;top:12px;right:12px;z-index:11;display:none;gap:8px;align-items:center;flex-wrap:wrap";
    this.controls.innerHTML = `<button data-threat="front">Threat front</button><button data-threat="left">Threat left</button><button data-threat="right">Threat right</button><button data-threat="rear">Threat rear</button><button data-action="surround">Surround square</button><button data-action="auto">Auto turns: off</button><button data-action="casualty">One casualty</button><button data-action="pause">Pause movement</button><button data-action="reset">Reset soldiers</button><span style="width:100%;color:#d7c98a">Cosmetic movement showcase · same soldier renderer · no gameplay or damage simulation</span>`;
    stage.append(this.canvas, this.controls);
    for (const button of this.controls.querySelectorAll<HTMLButtonElement>(
      "[data-threat]",
    ))
      button.onclick = () => {
        this.direction = {
          front: Math.PI / 2,
          left: Math.PI,
          right: 0,
          rear: -Math.PI / 2,
        }[button.dataset.threat!]!;
        this.surrounded = false;
      };
    this.controls.querySelector<HTMLButtonElement>(
      '[data-action="surround"]',
    )!.onclick = () => {
      this.surrounded = !this.surrounded;
    };
    this.controls.querySelector<HTMLButtonElement>(
      '[data-action="casualty"]',
    )!.onclick = () => {
      this.casualties = Math.min(12, this.casualties + 1);
    };
    this.controls.querySelector<HTMLButtonElement>(
      '[data-action="pause"]',
    )!.onclick = (event) => {
      this.paused = !this.paused;
      (event.currentTarget as HTMLButtonElement).textContent = this.paused
        ? "Resume movement"
        : "Pause movement";
    };
    this.controls.querySelector<HTMLButtonElement>(
      '[data-action="auto"]',
    )!.onclick = (event) => {
      this.auto = !this.auto;
      this.nextTurn = this.time + 4000;
      (event.currentTarget as HTMLButtonElement).textContent =
        `Auto turns: ${this.auto ? "on" : "off"}`;
    };
    this.controls.querySelector<HTMLButtonElement>(
      '[data-action="reset"]',
    )!.onclick = () => {
      this.actors.clear();
      this.casualties = 0;
      this.direction = Math.PI / 2;
      this.surrounded = false;
    };
    this.canvas.addEventListener("wheel", (event) => event.preventDefault(), {
      passive: false,
    });
    void this.actors.load().catch((error) => {
      this.error = String(error);
    });
  }
  show(source: Snapshot): void {
    this.source = source;
    this.visible = true;
    this.previous = undefined;
    this.canvas.style.display = "block";
    this.controls.style.display = "flex";
  }
  hide(): void {
    this.visible = false;
    this.canvas.style.display = "none";
    this.controls.style.display = "none";
    this.previous = undefined;
  }
  draw(now: number): void {
    if (!this.visible || !this.source) return;
    const elapsed =
      this.previous === undefined ? 0 : Math.min(100, now - this.previous);
    this.previous = now;
    if (!this.paused) this.time += elapsed;
    if (this.auto && this.time >= this.nextTurn) {
      this.direction += Math.PI / 2;
      this.nextTurn = this.time + 4000;
    }
    const width = this.canvas.clientWidth,
      height = this.canvas.clientHeight;
    const ratio = devicePixelRatio || 1;
    if (
      this.canvas.width !== Math.round(width * ratio) ||
      this.canvas.height !== Math.round(height * ratio)
    ) {
      this.canvas.width = Math.round(width * ratio);
      this.canvas.height = Math.round(height * ratio);
    }
    const ctx = this.canvas.getContext("2d")!;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#16231d";
    ctx.fillRect(0, 0, width, height);
    if (!this.actors.ready) {
      ctx.fillStyle = "#eee9d8";
      ctx.fillText(this.error ?? "Loading movement showcase…", 24, 140);
      return;
    }
    const columns = width >= 1050 ? 4 : 2,
      rows = Math.ceil(4 / columns);
    const cardWidth = width / columns,
      cardHeight = (height - 95) / rows;
    const tileSize = Math.min(cardWidth * 0.2, (cardHeight - 85) * 0.2);
    const centers = Array.from({ length: 4 }, (_, i) => ({
      x: ((i % columns) + 0.5) * cardWidth,
      y: 95 + (Math.floor(i / columns) + 0.5) * cardHeight,
    }));
    const project = (x: number, y: number) => {
      const i = Math.max(0, Math.min(3, Math.round(x / 8)));
      return {
        x: centers[i].x + (x - i * 8) * tileSize,
        y: centers[i].y + y * tileSize,
      };
    };
    const kinds = ["infantry", "archer", "infantry", "cavalry"] as const;
    const tick = this.time / 50;
    const release = Math.floor((tick - 10) / 60) * 60 + 10;
    const friendlies = kinds.map((kind, i) => {
      const template = this.source!.squads.find((s) => s.kind === kind)!;
      const soldierCount = demoSoldierCount(
        DEMO_TROOP_BY_ID.get(template.definitionId!)!,
      );
      return {
        ...template,
        id: 9000 + i,
        playerId: 1,
        x: i * 8 * FIXED,
        y: 0,
        troops: Math.floor(
          (Math.max(0, soldierCount - this.casualties) * 1000) / soldierCount,
        ),
        order: { type: "hold" as const },
        fighting: true,
        moved: false,
        combatTargetId: 9100 + i,
        structureTarget: undefined,
        charge: null,
        locomotion: {
          heading: this.direction - Math.PI / 2,
          targetHeading: this.direction - Math.PI / 2,
          speed: 0,
        },
        lastAttackTick: release,
        nextAttackTick: release + 60,
      };
    });
    const enemies = friendlies.map((squad, i) => ({
      ...squad,
      id: 9100 + i,
      playerId: 2,
      x: Math.round((i * 8 + Math.cos(this.direction) * 2.05) * FIXED),
      y: Math.round(Math.sin(this.direction) * 2.05 * FIXED),
      combatTargetId: squad.id,
    }));
    if (this.surrounded)
      for (let side = 1; side < 4; side++) {
        const direction = this.direction + (side * Math.PI) / 2;
        enemies.push({
          ...enemies[2],
          id: 9200 + side,
          x: Math.round((16 + Math.cos(direction) * 2.05) * FIXED),
          y: Math.round(Math.sin(direction) * 2.05 * FIXED),
        });
      }
    const ranged = friendlies[1],
      target = enemies[1];
    const volleys: ArcherVolley[] =
      release >= 0 && tick - release < 12 && ranged.troops > 0
        ? [
            {
              id: 100000 + release,
              tick: release,
              squadId: ranged.id,
              definitionId: ranged.definitionId,
              playerId: 1,
              fromX: ranged.x,
              fromY: ranged.y,
              toX: target.x,
              toY: target.y,
            },
          ]
        : [];
    this.actors.prune({
      ...this.source,
      squads: [...friendlies.filter((s) => s.troops > 0), ...enemies],
      volleys,
    });
    const labels = [
      `Infantry · ${this.formation}`,
      "Javelins · every rank",
      "Square · independent edges",
      "Cavalry · turn in place",
    ];
    for (let i = 0; i < 4; i++) {
      const left = (i % columns) * cardWidth,
        top = 95 + Math.floor(i / columns) * cardHeight;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left + 8, top, cardWidth - 16, cardHeight - 4);
      ctx.clip();
      ctx.fillStyle = "#1e3026";
      ctx.fillRect(left + 8, top, cardWidth - 16, cardHeight - 4);
      ctx.strokeStyle = "#3a4b3e";
      ctx.lineWidth = 1;
      for (let cell = -3; cell <= 3; cell++) {
        ctx.beginPath();
        ctx.moveTo(centers[i].x + (cell + 0.5) * tileSize, top);
        ctx.lineTo(centers[i].x + (cell + 0.5) * tileSize, top + cardHeight);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(left, centers[i].y + (cell + 0.5) * tileSize);
        ctx.lineTo(left + cardWidth, centers[i].y + (cell + 0.5) * tileSize);
        ctx.stroke();
      }
      ctx.fillStyle = "#eee9d8";
      ctx.font = "16px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(labels[i], centers[i].x, top + 26);
      ctx.font = "12px system-ui";
      ctx.fillStyle = "#b1c4b2";
      ctx.fillText(
        "Footprint holds · soldiers respond",
        centers[i].x,
        top + 48,
      );
      ctx.strokeStyle = "#88b8d5";
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(
        centers[i].x - tileSize / 2,
        centers[i].y - tileSize / 2,
        tileSize,
        tileSize,
      );
      ctx.setLineDash([]);
      for (const enemy of enemies.filter(
        (s) => s.combatTargetId === friendlies[i].id,
      )) {
        const point = project(enemy.x / FIXED, enemy.y / FIXED);
        ctx.fillStyle = "#e78367";
        ctx.beginPath();
        ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#edc9b9";
        ctx.fillText("Threat", point.x, point.y - 14);
      }
      ctx.restore();
    }
    this.actors.drawRemains(ctx, tileSize, project, width, height);
    for (let i = 0; i < 4; i++) {
      this.actors.formation =
        i === 2 ? "square" : i === 0 ? this.formation : "line";
      const squad = friendlies[i];
      if (squad.troops > 0)
        this.actors.draw(ctx, squad, centers[i], 0, tileSize, tick, {
          x: i * 8,
          y: 0,
        });
    }
    this.actors.flush(ctx);
    for (const volley of volleys)
      this.actors.drawVolley(
        ctx,
        volley,
        tick,
        tileSize,
        project,
        width,
        height,
      );
  }
}
