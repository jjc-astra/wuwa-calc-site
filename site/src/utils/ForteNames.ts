// Maps `forte{N}Name` to user-facing labels and `@Self.<Alias>` / `@Self.Max<Alias>` DSL identifiers.
type StatsLike = Record<string, any> | null | undefined;

export const forteNameKey = (index: number): string => `forte${index}Name`;

export function forteLabel(stats: StatsLike, index: number): string {
  const name = String(stats?.[forteNameKey(index)] ?? '').trim();
  return name || `Forte ${index}`;
}

// null when the slot has no name, or one with no usable identifier characters.
export function forteAlias(stats: StatsLike, index: number): string | null {
  const alias = String(stats?.[forteNameKey(index)] ?? '').replace(/[^A-Za-z0-9_]/g, '');
  return /^[A-Za-z_]/.test(alias) ? alias : null;
}

export function forteAliases(stats: StatsLike): string[] {
  const count = parseInt(String(stats?.forteCount ?? 1), 10) || 1;
  const aliases: string[] = [];
  for (let i = 1; i <= count; i++) {
    const alias = forteAlias(stats, i);
    if (alias) aliases.push(alias, `Max${alias}`);
  }
  return aliases;
}
