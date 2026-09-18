// Semantic equality for MechanicNodes: ignores runtime-only `_` fields (e.g. _compiledRule) and
// treats unset/empty values (undefined, null, '', [], {}) as equal, since the Builder's edit
// paths leave those behind when a field is cleared.
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
  // Time/number fields round-trip between "41" and 41 as they're edited.
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export function nodesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a) ?? null) === JSON.stringify(normalize(b) ?? null);
}
