// Centralizes `${namespace}_${name}` key conventions, parsing, and 'Generic'<->'System' aliasing.
// Pure string utilities with zero external dependencies to prevent circular imports.
import type { MechanicNode } from '../types/index';

export const SYSTEM_NAMESPACE = 'System';
export const GENERIC_ENTITY = 'Generic';

export const MechanicKey = {
  // Maps entity names to db namespaces ('Generic'/falsy -> 'System').
  toNamespace: (entityName: string | null | undefined): string =>
    (!entityName || entityName === GENERIC_ENTITY) ? SYSTEM_NAMESPACE : entityName,

  // Maps db namespaces back to UI entity names ('System' -> 'Generic').
  toEntityName: (namespace: string): string => (namespace === SYSTEM_NAMESPACE ? GENERIC_ENTITY : namespace),

  // Generates the `${namespace}_` key prefix for an entity.
  prefix: (entityName: string): string => `${MechanicKey.toNamespace(entityName)}_`,

  build: (entityName: string, name: string): string => `${MechanicKey.prefix(entityName)}${name.trim()}`,

  // Splits on the first underscore only to preserve underscores within the name itself.
  parse: (key: string): { namespace: string; name: string } => {
    const idx = key.indexOf('_');
    return idx === -1 ? { namespace: key, name: '' } : { namespace: key.slice(0, idx), name: key.slice(idx + 1) };
  },

  // Checks ownership against an entity, resolving Generic/System aliasing.
  belongsTo: (key: string, entityName: string): boolean => key.startsWith(MechanicKey.prefix(entityName)),

  // Strips a leading `${namespace}_` prefix from labels if present.
  stripNamespace: (name: string, namespace: string): string => {
    const prefix = `${namespace}_`;
    return name.startsWith(prefix) ? name.slice(prefix.length) : name;
  },

  // Looks up a node by key, falling back to prefixing with the System namespace.
  findNode: (db: Record<string, MechanicNode>, itemName: string): MechanicNode | undefined =>
    db[itemName] || db[MechanicKey.build(SYSTEM_NAMESPACE, itemName)]
};