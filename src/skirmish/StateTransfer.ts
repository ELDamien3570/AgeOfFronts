/** Explicit checkpoint methods use these helpers to preserve constructor-wired references. */
export function restoreArray<T>(target: T[], source: readonly T[]): void {
  target.length = 0;
  for (const value of source) target.push(value);
}
export function restoreMap<K, V>(target: Map<K, V>, source: Map<K, V>): void {
  target.clear(); for (const [key, value] of source) target.set(key, value);
}
export function restoreSet<T>(target: Set<T>, source: Set<T>): void {
  target.clear(); for (const value of source) target.add(value);
}
export function restoreRecord<T extends object>(target: T, source: T): void {
  const record = target as Record<string, unknown>;
  for (const key of Object.keys(target)) delete record[key];
  for (const [key, value] of Object.entries(source)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Invalid checkpoint property");
    record[key] = value;
  }
}
