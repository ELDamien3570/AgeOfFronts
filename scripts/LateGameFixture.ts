/** Local-only lossless checkpoint transport, shared by diagnostic exporters. */
export function serializeLateGameFixture(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "number" && (!Number.isFinite(item) || Object.is(item, -0)))
      return { $benchmark: "number", value: Object.is(item, -0) ? "-0" : String(item) };
    if (item instanceof Map) return { $benchmark: "map", entries: [...item] };
    if (item instanceof Set) return { $benchmark: "set", entries: [...item] };
    if (ArrayBuffer.isView(item)) return {
      $benchmark: "array", type: item.constructor.name,
      bytes: Buffer.from(item.buffer, item.byteOffset, item.byteLength).toString("base64"),
    };
    return item;
  });
}
