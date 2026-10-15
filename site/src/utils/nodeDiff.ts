// MechanicNode equality ignoring `_` fields; empty values are equal.
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const arr = value.map(normalize);
    return arr.length === 0 ? undefined : arr;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    Object.keys(value as Record<string, unknown>).sort().forEach(k => {
      if (k.startsWith('_')) return;
      const v = normalize((value as Record<string, unknown>)[k]);
      if (v !== undefined) out[k] = v;
    });
    return Object.keys(out).length === 0 ? undefined : out;
  }
  if (value === null || value === '') return undefined;
  // "41" equals 41.
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export function nodesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a) ?? null) === JSON.stringify(normalize(b) ?? null);
}
