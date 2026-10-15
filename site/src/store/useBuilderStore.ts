import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '../utils/safeLocalStorage';
import type { MechanicNode, BaseStats, EntityFolder, Effect } from '../types';
import { DataLoader } from '../utils/DataLoader';
import { MechanicKey } from '../utils/MechanicKey';
import { IMAGE_FOLDERS } from '../data/db';
import { nodesEqual } from '../utils/nodeDiff';
import type { PanelKey } from '../components/builder/MechanicNodeCard';

/** An effect removed in the Builder, with its index. */
export interface RemovedEffect { effect: Effect; index: number }

/** A node deleted in the Builder, with its neighbors for restoring. */
export interface RemovedNode { node: MechanicNode; after: string | null; before: string | null }

export type NodeChangeKind = 'modified' | 'renamed' | 'new';

// How a node differs from its pristine copy, or null.
export function nodeChangeKind(nodeId: string, node: MechanicNode | undefined, renamedFrom: Record<string, string>): NodeChangeKind | null {
  if (!node) return null;
  const origin = renamedFrom[nodeId] ?? nodeId;
  const pristine = DataLoader.pristineMechanics[origin];
  if (!pristine) return 'new';
  if (origin !== nodeId) return 'renamed';
  return nodesEqual(node, pristine) ? null : 'modified';
}

interface BuilderState {
  activeChar: string | null;
  activeFolder: string;
  activeRarity: number;
  baseStats: BaseStats;
  mechanics: Record<string, MechanicNode>;
  highlightedNodeId: string | null;
  // Hovered node/fields to highlight in JsonOutputPane.
  hoveredFieldHighlight: { nodeId: string; fields: string[] } | null;
  // Open sub-panel per node; kept here to survive renames.
  openPanelByNode: Record<string, PanelKey>;
  // Current id -> pristine id, for renamed nodes.
  renamedFrom: Record<string, string>;
  // Edit log for every edited entity, replayed by setActiveChar.
  editedBaseStats: Record<string, BaseStats>;
  editedMechanics: Record<string, MechanicNode>;
  deletedMechanicIds: string[];
  // Removed effects by node id, shown dimmed until restored.
  removedEffects: Record<string, RemovedEffect[]>;
  recordRemovedEffect: (nodeId: string, removed: RemovedEffect) => void;
  dropRemovedEffect: (nodeId: string, removedIndex: number) => void;
  // Deleted nodes by id, shown dimmed until restored.
  removedNodes: Record<string, RemovedNode>;
  // Removes a node but remembers it for restoring.
  softRemoveMechanicNode: (nodeId: string) => void;
  restoreRemovedNode: (nodeId: string) => void;
  discardRemovedNode: (nodeId: string) => void;
  setHighlightedNodeId: (nodeId: string | null) => void;
  setHoveredFieldHighlight: (highlight: { nodeId: string; fields: string[] } | null) => void;
  setOpenPanel: (nodeId: string, panel: PanelKey | null) => void;
  setActiveChar: (charName: string | null, folder?: string, rarity?: number) => Promise<void>;
  setBaseStat: (key: string, value: any) => void;
  // Replaces baseStats wholesale (e.g. JSON import).
  setAllBaseStats: (stats: BaseStats) => void;
  // insertAfter/insertBefore: position for a new node (default: end).
  setMechanicNode: (nodeId: string, node: MechanicNode, insertAfter?: string, insertBefore?: string) => void;
  renameMechanicNode: (oldId: string, newId: string, node: MechanicNode) => void;
  removeMechanicNode: (nodeId: string) => void;
  // Moves a node's key next to targetId.
  reorderMechanicNode: (nodeId: string, targetId: string, position: 'before' | 'after') => void;
  // Reverts a node to pristine (or drops it). False if its original id is taken.
  revertMechanicNode: (nodeId: string) => boolean;
  resetCache: () => void;
  hasChanges: (itemName: string) => boolean;
  // Drops itemName's edit log.
  discardChanges: (itemName: string) => void;
  // Edit log for `itemNames`, for the calc worker.
  getTeamOverrides: (itemNames: string[]) => {
    editedBaseStats: Record<string, BaseStats>;
    editedMechanics: Record<string, MechanicNode>;
    deletedMechanicIds: string[];
  };
}

const omit = <T,>(record: Record<string, T>, ...keys: string[]): Record<string, T> => {
  const copy = { ...record };
  keys.forEach(key => delete copy[key]);
  return copy;
};

const omitEntity = <T,>(record: Record<string, T>, entityName: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([id]) => !MechanicKey.belongsTo(id, entityName)));

const withoutEntityEdits = (state: BuilderState, entityName: string) => ({
  editedBaseStats: omit(state.editedBaseStats, entityName),
  editedMechanics: omitEntity(state.editedMechanics, entityName),
  deletedMechanicIds: state.deletedMechanicIds.filter(id => !MechanicKey.belongsTo(id, entityName)),
  renamedFrom: omitEntity(state.renamedFrom, entityName),
  removedEffects: omitEntity(state.removedEffects, entityName),
  removedNodes: omitEntity(state.removedNodes, entityName)
});

// Sets base stats on the store and the live DataLoader entry.
const withBaseStats = (state: BuilderState, baseStats: BaseStats) => {
  if (!state.activeChar) return { baseStats };
  DataLoader.editBaseStats(state.activeChar, baseStats);
  return { baseStats, editedBaseStats: { ...state.editedBaseStats, [state.activeChar]: baseStats } };
};

// Drops stale setActiveChar results.
let activeCharRequestSeq = 0;

// Image folder -> DataLoader mechanic folder.
export const mechFolderFor = (folder: string): EntityFolder => {
  const lower = folder.toLowerCase();
  if (lower === 'weapons') return 'weapons';
  if (lower === 'echo sets' || lower === 'sets') return 'sets';
  if (lower === 'echoes') return 'echoes';
  if (lower === 'system') return 'system';
  return 'characters';
};

// Mechanics Builder's open entity and the edit log of every edited entity.
export const useBuilderStore = create<BuilderState>()(
  persist(
    (set, get) => ({
      activeChar: null,
      activeFolder: IMAGE_FOLDERS.CHARACTERS,
      activeRarity: 5,
      baseStats: {},
      mechanics: {},
      highlightedNodeId: null,
      hoveredFieldHighlight: null,
      openPanelByNode: {},
      renamedFrom: {},
      editedBaseStats: {},
      editedMechanics: {},
      deletedMechanicIds: [],
      removedEffects: {},
      removedNodes: {},

      softRemoveMechanicNode: nodeId => {
        const { mechanics } = get();
        const node = mechanics[nodeId];
        if (!node) return;
        const keys = Object.keys(mechanics);
        const at = keys.indexOf(nodeId);
        set(state => ({ removedNodes: { ...state.removedNodes, [nodeId]: { node, after: keys[at - 1] ?? null, before: keys[at + 1] ?? null } } }));
        get().removeMechanicNode(nodeId);
      },

      restoreRemovedNode: nodeId => {
        const removed = get().removedNodes[nodeId];
        if (!removed) return;
        set(state => ({ removedNodes: omit(state.removedNodes, nodeId) }));
        get().setMechanicNode(nodeId, removed.node, removed.after ?? undefined, removed.before ?? undefined);
      },

      discardRemovedNode: nodeId => set(state => ({ removedNodes: omit(state.removedNodes, nodeId) })),

      recordRemovedEffect: (nodeId, removed) => set(state => ({
        removedEffects: { ...state.removedEffects, [nodeId]: [...(state.removedEffects[nodeId] || []), removed] }
      })),

      dropRemovedEffect: (nodeId, removedIndex) => set(state => {
        const rest = (state.removedEffects[nodeId] || []).filter((_, i) => i !== removedIndex);
        return { removedEffects: rest.length > 0 ? { ...state.removedEffects, [nodeId]: rest } : omit(state.removedEffects, nodeId) };
      }),
      setHighlightedNodeId: (nodeId) => set({ highlightedNodeId: nodeId }),
      setOpenPanel: (nodeId, panel) => set(state => {
        const updated = { ...state.openPanelByNode };
        if (panel) updated[nodeId] = panel;
        else delete updated[nodeId];
        return { openPanelByNode: updated };
      }),
      setHoveredFieldHighlight: (highlight) => set({ hoveredFieldHighlight: highlight }),

      setActiveChar: async (charName, folder = IMAGE_FOLDERS.CHARACTERS, rarity = 5) => {
        const requestId = ++activeCharRequestSeq;

        if (!charName) {
          set({ activeChar: null });
          return;
        }

        const mechFolder = mechFolderFor(folder);

        await DataLoader.loadMechanic(mechFolder, charName);

        if (requestId !== activeCharRequestSeq) return;

        // Replay edits after loadMechanic resets to pristine.
        const { editedBaseStats, editedMechanics, deletedMechanicIds } = get();
        const charEdits = editedBaseStats[charName];
        if (charEdits) DataLoader.editBaseStats(charName, charEdits);
        Object.entries(editedMechanics).forEach(([id, node]) => {
          if (MechanicKey.belongsTo(id, charName)) DataLoader.registerMechanicNode(id, node);
        });
        deletedMechanicIds.forEach(id => {
          if (MechanicKey.belongsTo(id, charName)) DataLoader.unregisterMechanicNode(id);
        });

        const loadedStats = DataLoader.baseStatsFor(charName) || {};
        const loadedMechs: Record<string, MechanicNode> = {};

        Object.keys(DataLoader.mechanicsDB).forEach(key => {
          if (MechanicKey.belongsTo(key, charName)) {
            loadedMechs[key] = DataLoader.mechanicsDB[key];
          }
        });

        set({
          activeChar: charName,
          activeFolder: folder,
          activeRarity: rarity,
          baseStats: { ...loadedStats },
          mechanics: loadedMechs
        });
      },

      setBaseStat: (key, value) => set(state => withBaseStats(state, { ...state.baseStats, [key]: value })),

      setAllBaseStats: stats => set(state => withBaseStats(state, stats)),

      setMechanicNode: (nodeId, node, insertAfter, insertBefore) => {
        set(state => {
          let updated: Record<string, MechanicNode>;
          // Only position new keys.
          const isNew = !(nodeId in state.mechanics);
          if (isNew && ((insertAfter && insertAfter in state.mechanics) || (insertBefore && insertBefore in state.mechanics))) {
            const after = insertAfter && insertAfter in state.mechanics ? insertAfter : null;
            updated = {};
            Object.entries(state.mechanics).forEach(([key, val]) => {
              if (!after && key === insertBefore) updated[nodeId] = node;
              updated[key] = val;
              if (key === after) updated[nodeId] = node;
            });
          } else {
            updated = { ...state.mechanics, [nodeId]: node };
          }
          DataLoader.registerMechanicNode(nodeId, node);
          // Identical to pristine isn't an edit.
          const nextEdits = { ...state.editedMechanics, [nodeId]: node };
          const pristine = DataLoader.pristineMechanics[nodeId];
          if (pristine && !state.renamedFrom[nodeId] && nodesEqual(node, pristine)) delete nextEdits[nodeId];
          return {
            mechanics: updated,
            editedMechanics: nextEdits,
            deletedMechanicIds: state.deletedMechanicIds.filter(id => id !== nodeId)
          };
        });
      },

      renameMechanicNode: (oldId, newId, node) => {
        if (oldId === newId) {
          get().setMechanicNode(oldId, node);
          return;
        }
        set(state => {
          // Swap keys in place to keep order.
          const updated: Record<string, MechanicNode> = {};
          Object.entries(state.mechanics).forEach(([key, val]) => {
            if (key === oldId) updated[newId] = node;
            else updated[key] = val;
          });
          DataLoader.unregisterMechanicNode(oldId);
          DataLoader.registerMechanicNode(newId, node);

          const updatedEdits = { ...omit(state.editedMechanics, oldId), [newId]: node };

          const updatedOpenPanel = { ...state.openPanelByNode };
          if (updatedOpenPanel[oldId] !== undefined) {
            updatedOpenPanel[newId] = updatedOpenPanel[oldId];
            delete updatedOpenPanel[oldId];
          }

          // Always points at the pristine original.
          const origin = state.renamedFrom[oldId] ?? oldId;
          const updatedRenamed = omit(state.renamedFrom, oldId);
          if (newId !== origin && DataLoader.pristineMechanics[origin]) updatedRenamed[newId] = origin;
          if (newId === origin && nodesEqual(node, DataLoader.pristineMechanics[origin])) delete updatedEdits[newId];

          return {
            mechanics: updated,
            editedMechanics: updatedEdits,
            openPanelByNode: updatedOpenPanel,
            renamedFrom: updatedRenamed,
            removedEffects: state.removedEffects[oldId]
              ? { ...omit(state.removedEffects, oldId), [newId]: state.removedEffects[oldId] }
              : state.removedEffects,
            // Keeps a re-fetch from resurrecting oldId.
            deletedMechanicIds: [...state.deletedMechanicIds.filter(id => id !== oldId && id !== newId), oldId]
          };
        });
      },

      reorderMechanicNode: (nodeId, targetId, position) => {
        set(state => {
          if (nodeId === targetId || !(nodeId in state.mechanics) || !(targetId in state.mechanics)) return {};
          const node = state.mechanics[nodeId];
          const updated: Record<string, MechanicNode> = {};
          Object.entries(state.mechanics).forEach(([key, val]) => {
            if (key === nodeId) return;
            if (key === targetId && position === 'before') updated[nodeId] = node;
            updated[key] = val;
            if (key === targetId && position === 'after') updated[nodeId] = node;
          });
          return {
            mechanics: updated,
            // Key order change counts as an edit.
            editedMechanics: { ...state.editedMechanics, [nodeId]: node }
          };
        });
      },

      revertMechanicNode: nodeId => {
        const state = get();
        const origin = state.renamedFrom[nodeId] ?? nodeId;
        const pristine = DataLoader.pristineMechanics[origin];
        if (pristine && origin !== nodeId && origin in state.mechanics) return false;

        DataLoader.unregisterMechanicNode(nodeId);
        const restored: MechanicNode | null = pristine ? JSON.parse(JSON.stringify(pristine)) : null;
        if (restored) DataLoader.registerMechanicNode(origin, restored);

        set(s => {
          const updated: Record<string, MechanicNode> = {};
          Object.entries(s.mechanics).forEach(([key, val]) => {
            if (key !== nodeId) updated[key] = val;
            else if (restored) updated[origin] = restored;
          });

          const nextOpenPanel = { ...s.openPanelByNode };
          if (restored && origin !== nodeId && nextOpenPanel[nodeId] !== undefined) nextOpenPanel[origin] = nextOpenPanel[nodeId];
          delete nextOpenPanel[nodeId];

          return {
            mechanics: updated,
            editedMechanics: omit(s.editedMechanics, nodeId, origin),
            renamedFrom: omit(s.renamedFrom, nodeId),
            openPanelByNode: nextOpenPanel,
            removedEffects: omit(s.removedEffects, nodeId, origin),
            deletedMechanicIds: s.deletedMechanicIds.filter(id => id !== nodeId && id !== origin)
          };
        });
        return true;
      },

      removeMechanicNode: nodeId => {
        set(state => {
          DataLoader.unregisterMechanicNode(nodeId);

          return {
            mechanics: omit(state.mechanics, nodeId),
            editedMechanics: omit(state.editedMechanics, nodeId),
            openPanelByNode: omit(state.openPanelByNode, nodeId),
            renamedFrom: omit(state.renamedFrom, nodeId),
            removedEffects: omit(state.removedEffects, nodeId),
            deletedMechanicIds: [...state.deletedMechanicIds.filter(id => id !== nodeId), nodeId]
          };
        });
      },

      hasChanges: itemName => {
        const { editedBaseStats, editedMechanics, deletedMechanicIds } = get();
        if (editedBaseStats[itemName]) return true;
        const isItems = (id: string) => MechanicKey.belongsTo(id, itemName);
        return Object.keys(editedMechanics).some(isItems) || deletedMechanicIds.some(isItems);
      },

      discardChanges: itemName => {
        const isActive = get().activeChar === itemName;
        set(state => ({
          ...withoutEntityEdits(state, itemName),
          ...(isActive ? { baseStats: {}, mechanics: {} } : {})
        }));
        // Base-stat edits live on the DataLoader entry too.
        DataLoader.restoreBaseStats(itemName);
        if (isActive) set({ baseStats: { ...(DataLoader.baseStatsFor(itemName) || {}) } as BaseStats });
      },

      getTeamOverrides: itemNames => {
        const { editedBaseStats, editedMechanics, deletedMechanicIds } = get();
        const names = new Set(itemNames);
        const matchesAny = (id: string) => itemNames.some(name => MechanicKey.belongsTo(id, name));
        return {
          editedBaseStats: Object.fromEntries(Object.entries(editedBaseStats).filter(([name]) => names.has(name))),
          // Strip _compiledRule (not cloneable).
          editedMechanics: Object.fromEntries(
            Object.entries(editedMechanics)
              .filter(([id]) => matchesAny(id))
              .map(([id, node]) => [id, { ...node, _compiledRule: undefined }])
          ),
          deletedMechanicIds: deletedMechanicIds.filter(matchesAny)
        };
      },

      resetCache: async () => {
        const { activeChar, activeFolder, activeRarity } = get();
        if (!activeChar) return;

        const mechFolder = mechFolderFor(activeFolder);

        DataLoader.clearMechanicCache(mechFolder, activeChar);
        DataLoader.restoreBaseStats(activeChar);

        set(state => ({ baseStats: {}, mechanics: {}, ...withoutEntityEdits(state, activeChar) }));
        await get().setActiveChar(activeChar, activeFolder, activeRarity);
      }
    }),
    {
      name: 'wuwa_builder_cache',
      storage: persistStorage(),
      // mechanics/baseStats are re-derived on load.
      partialize: (state) => ({
        activeChar: state.activeChar,
        activeFolder: state.activeFolder,
        activeRarity: state.activeRarity,
        editedBaseStats: state.editedBaseStats,
        editedMechanics: state.editedMechanics,
        deletedMechanicIds: state.deletedMechanicIds,
        renamedFrom: state.renamedFrom,
        removedEffects: state.removedEffects,
        removedNodes: state.removedNodes
      })
    }
  )
);