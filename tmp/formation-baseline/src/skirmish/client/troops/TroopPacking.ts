import {
  formationSlots,
  type FormationLayout,
  type FormationShape,
} from "./TroopFormationModel";
/** Shared packing accepts a fixed authored size from any actor catalogue. */
export function actorFormationSlots(
  layout: FormationLayout,
  mounted: boolean,
  shape: FormationShape,
  scale: number,
  actor?: {
    vehicle?: boolean;
    members?: number;
    widthWorld?: number;
    lengthWorld?: number;
  },
) {
  if (actor?.vehicle) {
    const count = actor.members ?? 1;
    const footprint = 2 / 0.75;
    const width = ((actor.widthWorld ?? 2) + 0.4) / footprint;
    const depth = ((actor.lengthWorld ?? 4) + 0.6) / footprint;
    // Vehicles keep clear hull lanes. Line is abreast; mobile travel uses a
    // staggered pair. Neither shape becomes an infantry square or charge wedge.
    return Array.from({ length: count }, (_, index) => ({
      x: (index - (count - 1) / 2) * width,
      y: shape === "line" ? 0 : (index - (count - 1) / 2) * depth * 0.55,
      row: shape === "line" ? 0 : index,
      scale,
    }));
  }
  const slots = formationSlots(layout, mounted ? 6 : 12, shape, 1, mounted);
  if (!mounted) return slots.map((slot) => ({ ...slot, scale }));
  if (shape === "mass") {
    // Horse-length clearance in every direction: a crowd must remain readable
    // as riders turn, rather than depending on mounts always facing forward.
    const radius = scale * (400 / 512) + 0.12 / (2 / 0.75);
    return slots.map((slot, index) => {
      const angle = Math.PI / 6 + (index * Math.PI) / 3;
      const x = Math.cos(angle) * radius,
        y = Math.sin(angle) * radius;
      return { ...slot, x, y, row: Math.round(y * 1000), scale };
    });
  }
  const minX = Math.min(...slots.map((s) => s.x)),
    maxX = Math.max(...slots.map((s) => s.x));
  // Fixed idle mount/rider envelope excludes transparent padding and weapon
  // reach. No per-frame alpha fitting: animation cannot change packing or size.
  const availableX = Math.max(0, 0.75 - scale * (230 / 512));
  const fitX = Math.min(1, availableX / (maxX - minX || 1));
  const ranks = [...new Set(slots.map((slot) => slot.row))].sort(
    (a, b) => a - b,
  );
  // Keep complete mounts apart, plus 0.12 world tiles of daylight. Rank depth
  // is presentation-only and may exceed the nominal two-cell squad footprint.
  const rankPitch = scale * (400 / 512) + 0.12 / (2 / 0.75);
  return slots.map((slot) => ({
    ...slot,
    scale,
    x: (slot.x - (minX + maxX) / 2) * fitX,
    y: (ranks.indexOf(slot.row) - (ranks.length - 1) / 2) * rankPitch,
  }));
}
