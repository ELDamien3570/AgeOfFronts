export interface RankingState<T> {
  rows: T[];
  buffer: T[];
  width: number;
  left: number;
  i: number;
  j: number;
  k: number;
  merging: boolean;
  done: boolean;
}
export function ranking<T>(rows: T[]): RankingState<T> {
  return {
    rows,
    buffer: [],
    width: 1,
    left: 0,
    i: 0,
    j: 0,
    k: 0,
    merging: false,
    done: rows.length < 2,
  };
}
/** Stable bottom-up merge: one output row or one merge boundary per allowance. */
export function rankStep<T>(
  s: RankingState<T>,
  compare: (a: T, b: T) => number,
  budget: number,
): number {
  let used = 0;
  while (used < budget && !s.done) {
    used++;
    if (!s.merging) {
      if (s.left >= s.rows.length) {
        [s.rows, s.buffer] = [s.buffer, s.rows];
        s.width *= 2;
        s.left = 0;
        if (s.width >= s.rows.length) {
          s.done = true;
          continue;
        }
      }
      s.i = s.left;
      s.j = Math.min(s.left + s.width, s.rows.length);
      s.k = s.left;
      s.merging = true;
      continue;
    }
    const middle = Math.min(s.left + s.width, s.rows.length),
      end = Math.min(s.left + 2 * s.width, s.rows.length);
    if (s.i >= middle && s.j >= end) {
      s.left = end;
      s.merging = false;
      continue;
    }
    s.buffer[s.k++] =
      s.j >= end || (s.i < middle && compare(s.rows[s.i], s.rows[s.j]) <= 0)
        ? s.rows[s.i++]
        : s.rows[s.j++];
  }
  return used;
}
