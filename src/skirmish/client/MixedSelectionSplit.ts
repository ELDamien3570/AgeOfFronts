import type { Army } from "../domain/Definitions";
import type { Squad } from "../Protocol";

type SquadFacts = Pick<Squad, "id" | "troops" | "embarkedOn" | "refit" | "manpower">;
/** The server's own test for an army member that takes army orders. */
const active = (s: SquadFacts | undefined): s is SquadFacts =>
  !!s && s.troops > 0 && s.embarkedOn === null && !s.refit && !s.manpower?.enlargement;

/**
 * D4 (R2-P2): the server rejects a move whose selection mixes an army with
 * other squads, because that move would run synchronous cold routing. The
 * client therefore sends one move per whole army it selects and one for the
 * selected squads outside armies, as if the player had ordered each in turn.
 * Members of an army selected without the rest of their army stay together in
 * `partial`: the server still rejects that move with its translated message.
 */
export function splitMoveSelection(
  ids: readonly number[],
  armies: readonly Pick<Army, "id" | "memberIds">[],
  squads: readonly SquadFacts[],
): { groups: number[][]; partial: number[] } {
  const selected = new Set(ids), byId = new Map(squads.map(s => [s.id, s]));
  const inArmy = new Set<number>(), groups: number[][] = [], partial: number[] = [];
  for (const army of [...armies].sort((a, b) => a.id - b.id)) {
    const chosen = army.memberIds.filter(id => selected.has(id));
    if (!chosen.length) continue;
    for (const id of army.memberIds) inArmy.add(id);
    const available = army.memberIds.filter(id => active(byId.get(id)));
    if (available.length && available.every(id => selected.has(id))) groups.push(available);
    else partial.push(...chosen);
  }
  const loose = ids.filter(id => !inArmy.has(id));
  if (loose.length) groups.push(loose);
  return { groups, partial };
}
