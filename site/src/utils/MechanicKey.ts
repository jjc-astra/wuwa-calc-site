// Centralizes `${namespace}_${name}` key conventions and parsing. 'System' is the one name for
// the team-independent entity (Dodge, Jump, Tune Break...) everywhere in the app -- state, UI,
// and mechanicsDB keys alike. The only place a different name exists is the data repo's on-disk
// asset naming (mechanics/system/system.json, Icon_Generic.webp), which DataLoader.ts and
// Common.ts's getIconPath each translate at that one boundary.
// Pure string utilities with zero external dependencies to prevent circular imports.
import type { MechanicNode, MoveOrigin } from '../types/index';

export const SYSTEM_NAMESPACE = 'System';

export const MechanicKey = {
  // Namespace for a possibly-absent active entity -- defaults to System.
  toNamespace: (entityName: string | null | undefined): string => entityName || SYSTEM_NAMESPACE,

  // Generates the `${namespace}_` key prefix for an entity.
  prefix: (entityName: string): string => `${MechanicKey.toNamespace(entityName)}_`,

  build: (entityName: string, name: string): string => `${MechanicKey.prefix(entityName)}${name.trim()}`,

  // Splits on the first underscore only to preserve underscores within the name itself.
  parse: (key: string): { namespace: string; name: string } => {
    const idx = key.indexOf('_');
    return idx === -1 ? { namespace: key, name: '' } : { namespace: key.slice(0, idx), name: key.slice(idx + 1) };
  },

  // Checks ownership against an entity, defaulting an absent entity to System.
  belongsTo: (key: string, entityName: string): boolean => key.startsWith(MechanicKey.prefix(entityName)),

  // Strips a leading `${namespace}_` prefix from labels if present.
  stripNamespace: (name: string, namespace: string): string => {
    const prefix = `${namespace}_`;
    return name.startsWith(prefix) ? name.slice(prefix.length) : name;
  },

  // A move's origin. The owner is the key's namespace, not whoever casts it -- an echo skill cast
  // by Lumi is @Inferno Rider(...). `caster` stands in as the owner when there's no key to read.
  origin: (key: string | undefined, caster: string, moveName: string | undefined): MoveOrigin => {
    const owner = key?.includes('_') ? MechanicKey.parse(key).namespace : caster;
    return { caster, owner, ref: `@${owner}(${moveName})` };
  },

  // Looks up a node by key, falling back to prefixing with the System namespace.
  findNode: (db: Record<string, MechanicNode>, itemName: string): MechanicNode | undefined =>
    db[itemName] || db[MechanicKey.build(SYSTEM_NAMESPACE, itemName)]
};