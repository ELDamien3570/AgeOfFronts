export interface ActorFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  pivot: { x: number; y: number };
}
export interface ActorClip {
  id: string;
  file: string;
  mask?: string;
  frameCount: number;
  loop?: boolean;
  fps?: number;
  durations?: number[];
  scale?: number;
  frames: ActorFrame[];
  releaseFrame?: number;
}
export interface ActorManifest {
  actorCount: number;
  animations: ActorClip[];
}
export interface FormationLayout {
  frameSize: { width: number; height: number };
  pivot: { x: number; y: number };
  memberScale: number;
  layouts: { standard: Record<string, { x: number; y: number }> };
}
export interface FormationSlot {
  x: number;
  y: number;
  row: number;
  scale: number;
  angle?: number;
}
export type ManualFormation = "mass" | "line" | "shield-wall" | "square";
export type FormationShape = ManualFormation | "wedge";

export function resolveFormation(
  selected: ManualFormation,
  mounted: boolean,
  charging: boolean,
): FormationShape {
  return charging
    ? "wedge"
    : mounted && selected !== "mass"
      ? "line"
      : selected;
}

export function representativeCount(
  soldiers: number,
  _mounted: boolean,
): number {
  return soldiers;
}

/** Three separated 20-v-20 encounters, expressed in tile offsets from a cell center. */
export function battlePreviewPlacement(index: number): {
  x: number;
  y: number;
  enemy: boolean;
} {
  const encounter = Math.floor(index / 40);
  const within = index % 40;
  const enemy = within >= 20;
  const unit = within % 20;
  return {
    x: (encounter - 1) * 7 + (unit % 5) - 2,
    y: enemy ? -2 - Math.floor(unit / 5) : Math.floor(unit / 5),
    enemy,
  };
}

/** Cosmetic templates in formation-frame coordinates. They never alter squad geometry. */
export function formationSlots(
  layout: FormationLayout,
  soldiers: number,
  shape: FormationShape,
  spacingMultiplier = 1,
  mounted = false,
): FormationSlot[] {
  const authored = calibratedSlots(layout, soldiers);
  const scale = authored[0]?.scale ?? layout.memberScale;
  const slots: FormationSlot[] = [];
  const grid = (columns: number, spanX: number, spanY: number) => {
    const rows = Math.ceil(soldiers / columns);
    const rearCount = soldiers - (rows - 1) * columns;
    for (let row = 0; row < rows; row++) {
      const count = row === 0 ? rearCount : columns;
      for (let column = 0; column < count; column++) {
        slots.push({
          x: ((column - (count - 1) / 2) * spanX) / Math.max(1, columns - 1),
          y: ((row - (rows - 1) / 2) * spanY) / Math.max(1, rows - 1),
          row,
          scale,
          angle: 0,
        });
      }
    }
  };
  if (shape === "mass") {
    const outerCount = soldiers <= 6 ? soldiers : Math.ceil((soldiers * 2) / 3);
    const innerCount = soldiers - outerCount;
    const ring = (count: number, radius: number, phase: number) => {
      for (let i = 0; i < count; i++) {
        const angle = phase + (i * Math.PI * 2) / count;
        const r = radius * (1 + (((i * 7) % 5) - 2) * 0.015);
        const x = Math.cos(angle) * r,
          y = Math.sin(angle) * r;
        slots.push({ x, y, row: Math.round(y * 1000), scale, angle: 0 });
      }
    };
    ring(outerCount, 0.35, Math.PI / 8);
    ring(innerCount, 0.14, Math.PI / 4);
    // Layout identity is permanent; no direction-dependent rank assignment.
    slots.sort((a, b) => a.row - b.row || a.x - b.x);
  } else if (shape === "line") {
    const spacing = scale * 0.65;
    const columns = Math.min(
        soldiers,
        Math.ceil(Math.sqrt((soldiers * 4) / 3)),
      ),
      rows = Math.ceil(soldiers / columns);
    grid(
      columns,
      mounted
        ? (columns - 1) * spacing
        : ((columns - 1) * 0.6) /
            Math.max(1, Math.ceil(Math.sqrt(soldiers)) - 1),
      (rows - 1) * spacing,
    );
  } else if (shape === "shield-wall") grid(Math.ceil(soldiers / 2), 0.74, 0.17);
  else if (shape === "wedge") {
    const ranks = Math.ceil((Math.sqrt(8 * soldiers + 1) - 1) / 2);
    const counts = Array.from({ length: ranks }, (_, row) => row + 1);
    let excess = (ranks * (ranks + 1)) / 2 - soldiers;
    // Distribute unused capacity across the widening ranks, rather than leaving a narrow rear row.
    for (let row = ranks - 1; excess > 0 && row > 0; row--) {
      if (counts[row] > counts[row - 1]) {
        counts[row]--;
        excess--;
      }
    }
    const pitchX = scale * 0.65,
      pitchY = scale * (mounted ? 0.75 : 0.5);
    for (let row = 0; row < ranks; row++) {
      for (let column = 0; column < counts[row]; column++) {
        slots.push({
          x: (column - (counts[row] - 1) / 2) * pitchX,
          y: ((ranks - 1) / 2 - row) * pitchY,
          row: ranks - 1 - row,
          scale,
          angle: 0,
        });
      }
    }
    slots.sort((a, b) => a.row - b.row || a.x - b.x);
  } else if (shape === "square") {
    let remaining = soldiers;
    const outerCount = soldiers <= 5 ? soldiers : Math.ceil(soldiers * 0.6);
    const outerRadius = (outerCount * scale * 0.8) / 8;
    let ring = 0;
    while (remaining > 0) {
      const ringCount = Math.min(remaining, Math.max(4, outerCount - ring * 4));
      const radius = Math.max(scale * 0.16, outerRadius - ring * scale * 0.36);
      for (let i = 0; i < ringCount; i++) {
        const distance = (i * 4) / ringCount;
        const side = Math.floor(distance),
          t = distance - side;
        const points = [
          { x: -radius + t * radius * 2, y: -radius, angle: Math.PI },
          { x: radius, y: -radius + t * radius * 2, angle: -Math.PI / 2 },
          { x: radius - t * radius * 2, y: radius, angle: 0 },
          { x: -radius, y: radius - t * radius * 2, angle: Math.PI / 2 },
        ];
        slots.push({
          ...points[side],
          row: 1,
          scale,
        });
      }
      remaining -= ringCount;
      ring++;
    }
  }
  return slots.map((slot) => ({
    ...slot,
    x: slot.x * spacingMultiplier,
    y: slot.y * spacingMultiplier,
  }));
}

export function blendFormationSlots(
  from: readonly FormationSlot[],
  to: readonly FormationSlot[],
  progress: number,
): FormationSlot[] {
  if (from.length !== to.length || progress >= 1) return [...to];
  const t = Math.max(0, Math.min(1, progress)),
    smooth = t * t * (3 - 2 * t);
  return to.map((target, i) => {
    const source = from[i],
      a = source.angle ?? 0,
      b = target.angle ?? 0;
    const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    return {
      x: source.x + (target.x - source.x) * smooth,
      y: source.y + (target.y - source.y) * smooth,
      scale: source.scale + (target.scale - source.scale) * smooth,
      row: target.row,
      angle: a + delta * smooth,
    };
  });
}

/** Five actors reuse their authored composition. Denser layouts keep its canvas envelope. */
export function calibratedSlots(
  layout: FormationLayout,
  soldiers: number,
): FormationSlot[] {
  const standard = Object.entries(layout.layouts.standard);
  if (soldiers === standard.length) {
    return standard
      .sort(
        ([a], [b]) =>
          Number(!a.startsWith("rear")) - Number(!b.startsWith("rear")),
      )
      .map(([id, point]) => ({
        x: (point.x - layout.pivot.x) / layout.frameSize.width,
        y: (point.y - layout.pivot.y) / layout.frameSize.height,
        row: id.startsWith("rear") ? 0 : 1,
        scale: layout.memberScale,
      }));
  }
  const columns = Math.ceil(Math.sqrt(soldiers)),
    rows = Math.ceil(soldiers / columns);
  const points = standard.map(([, point]) => point);
  const halfWidth =
    (Math.max(...points.map((p) => p.x)) -
      Math.min(...points.map((p) => p.x))) /
    2 /
    layout.frameSize.width;
  const halfHeight =
    (Math.max(...points.map((p) => p.y)) -
      Math.min(...points.map((p) => p.y))) /
    2 /
    layout.frameSize.height;
  const scale = layout.memberScale * Math.min(1, 3 / columns, 2 / rows);
  return Array.from({ length: soldiers }, (_, slot) => {
    const row = Math.floor(slot / columns),
      rowCount = Math.min(columns, soldiers - row * columns);
    return {
      x:
        (((slot % columns) - (rowCount - 1) / 2) * 2 * halfWidth) /
        Math.max(1, columns - 1),
      y: ((row - (rows - 1) / 2) * 2 * halfHeight) / Math.max(1, rows - 1),
      row,
      scale,
    };
  });
}
export function frontRankCount(
  slots: readonly FormationSlot[],
  live: number,
): number {
  if (live <= 0) return 0;
  const row = slots[live - 1].row;
  let count = 0;
  for (let index = live - 1; index >= 0 && slots[index].row === row; index--)
    count++;
  return count;
}

/** Honor authored variable durations, including cavalry clips without fps. */
export function clipFrame(clip: ActorClip, elapsedMs: number): number {
  const durations =
    clip.durations ?? Array(clip.frameCount).fill(1000 / (clip.fps ?? 6));
  const length = durations.reduce((sum, value) => sum + value, 0);
  let time = Math.max(0, elapsedMs);
  if (clip.loop) time %= length;
  else if (time >= length) return clip.frameCount - 1;
  for (let index = 0; index < durations.length; index++) {
    if (time < durations[index]) return index;
    time -= durations[index];
  }
  return clip.frameCount - 1;
}
export function liveSlotCount(soldiers: number, strength: number): number {
  return Math.ceil((soldiers * Math.max(0, Math.min(100, strength))) / 100);
}
export function formationVisible(
  x: number,
  y: number,
  radius: number,
  width: number,
  height: number,
): boolean {
  return (
    x + radius >= 0 &&
    y + radius >= 0 &&
    x - radius <= width &&
    y - radius <= height
  );
}
