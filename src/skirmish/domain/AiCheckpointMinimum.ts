/** Missing means no finite minimum has been observed. Legacy checkpoints used
 * positive infinity; migrate it losslessly without teaching the transport to
 * accept arbitrary nonfinite physical state. Finite values stay exact. */
export function restoreAiMinimum(value: number | undefined): number | undefined {
  if (value === undefined || value === Infinity) return undefined;
  if (!Number.isFinite(value)) throw Error("Invalid AI checkpoint minimum");
  return value;
}
