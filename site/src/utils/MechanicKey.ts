// `${namespace}_${name}` key helpers. No runtime imports (avoids cycles).
import type { MechanicNode, MoveOrigin } from '../types/index';

export const SYSTEM_NAMESPACE = 'System';

export const MechanicKey = {
  // Defaults to System.
  toNamespace: (entityName: string | null | undefined): string => entityName || SYSTEM_NAMESPACE,

  prefix: (entityName: string | null | undefined): string => `${MechanicKey.toNamespace(entityName)}_`,

  build: (entityName: string | null | undefined, name: string): string => `${MechanicKey.prefix(entityName)}${name.trim()}`,

  // Splits on the first underscore only.
  parse: (key: string): { namespace: string; name: string } => {
    const idx = key.indexOf('_');
    return idx === -1 ? { namespace: key, name: '' } : { namespace: key.slice(0, idx), name: key.slice(idx + 1) };
  },

  belongsTo: (key: string, entityName: string): boolean => key.startsWith(MechanicKey.prefix(entityName)),

  stripNamespace: (name: string, namespace: string): string => {
    const prefix = `${namespace}_`;
    return name.startsWith(prefix) ? name.slice(prefix.length) : name;
  },

  // Owner is the key's namespace, not the caster; `caster` is the fallback.
  origin: (key: string | undefined, caster: string, moveName: string | undefined): MoveOrigin => {
    const owner = key?.includes('_') ? MechanicKey.parse(key).namespace : caster;
    return { caster, owner, ref: `@${owner}(${moveName})` };
  },

  // Falls back to the System namespace.
  findNode: (db: Record<string, MechanicNode>, itemName: string): MechanicNode | undefined =>
    db[itemName] || db[MechanicKey.build(SYSTEM_NAMESPACE, itemName)]
};