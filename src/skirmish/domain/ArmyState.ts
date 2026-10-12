import type { Army, ArmySlotRecord } from "./Definitions";
const roles = [
  "frontline",
  "ranged",
  "mounted-left",
  "mounted-right",
  "support",
  "reserve",
];
export function validateArmyRecords(rows: readonly Army[]): void {
  if (!Array.isArray(rows) || rows.length > 4100) throw Error("Invalid armies");
  const ids = new Set<number>(),
    members = new Set<number>();
  for (const a of rows) {
    if (
      !a ||
      !Number.isSafeInteger(a.id) ||
      a.id < 1 ||
      ids.has(a.id) ||
      !Number.isSafeInteger(a.playerId) ||
      a.playerId < 1 ||
      !Array.isArray(a.memberIds) ||
      a.memberIds.length > 60 ||
      new Set(a.memberIds).size !== a.memberIds.length ||
      [a.x, a.y, a.facing].some((n) => !Number.isFinite(n)) ||
      (a.terrainReserveIds!==undefined&&(!Array.isArray(a.terrainReserveIds)||a.terrainReserveIds.length>2||new Set(a.terrainReserveIds).size!==a.terrainReserveIds.length||a.terrainReserveIds.some((id:number)=>!Number.isSafeInteger(id)||id<1))) ||
      (a.terrainPosition!==undefined&&typeof a.terrainPosition!=="boolean") ||
      (a.posture !== undefined &&
        !["line", "defend", "skirmish"].includes(a.posture))
    )
      throw Error("Invalid army record");
    ids.add(a.id);
    for (const id of a.memberIds) {
      if (!Number.isSafeInteger(id) || id < 1 || members.has(id))
        throw Error("Invalid army membership");
      members.add(id);
    }
    if (a.slots !== undefined) {
      if (
        !Array.isArray(a.slots) ||
        a.slots.length > a.memberIds.length ||
        new Set(a.slots.map((s: ArmySlotRecord) => s.squadId)).size !==
          a.slots.length ||
        new Set(a.slots.map((s: ArmySlotRecord) => s.index)).size !==
          a.slots.length
      )
        throw Error("Invalid army slots");
      for (const r of a.slots)
        if (
          !a.memberIds.includes(r.squadId) ||
          !roles.includes(r.role) ||
          !Number.isSafeInteger(r.index) ||
          r.index < 0 ||
          typeof r.widthRev !== "string" ||
          r.widthRev.length > 1024 ||
          [r.lateral, r.depth, r.width, r.bodyDepth].some(
            (n) => !Number.isSafeInteger(n) || Math.abs(n) > 2147483647,
          ) ||
          r.width < 0 ||
          r.bodyDepth < 0
        )
          throw Error("Invalid army slot");
    }
    for (const r of a.slots ?? [])
      if (r.widthRev) {
        let key: unknown;
        try {
          key = JSON.parse(r.widthRev);
        } catch {
          throw Error("Invalid army width key");
        }
        if (!Array.isArray(key) || key.length > 32 || key[0] !== r.squadId)
          throw Error("Invalid army width key");
      }
    for (const n of [
      a.slotRevision,
      a.lastLayoutTick,
      a.lastFacingTick,
      a.nextSlotIndex,
      a.initialTroops,
      a.lastGapTick,
      a.withdrawalTick,
      a.lastAdvanceTick,
    ])
      if (n !== undefined && (!Number.isSafeInteger(n) || n < 0))
        throw Error("Invalid army revision");
    if (
      a.reservePlan !== undefined &&
      (typeof a.reservePlan !== "string" || a.reservePlan.length > 64)
    )
      throw Error("Invalid reserve plan");
    if (
      a.frontGaps &&
      (a.frontGaps.length > 60 ||
        a.frontGaps.some(
          (g: NonNullable<Army["frontGaps"]>[number]) =>
            [g.index, g.lateral, g.depth, g.width].some(
              (n) => !Number.isSafeInteger(n) || Math.abs(n) > 2147483647,
            ) ||
            g.index < 0 ||
            g.width < 0,
        ))
    )
      throw Error("Invalid army gap");
  }
}
