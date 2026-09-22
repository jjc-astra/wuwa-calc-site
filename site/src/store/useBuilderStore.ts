import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '../utils/safeLocalStorage';
import type { MechanicNode, BaseStats, EntityFolder } from '../types';
import { DataLoader } from '../utils/DataLoader';
import { MechanicKey } from '../utils/MechanicKey';
import { IMAGE_FOLDERS } from '../data/db';
import { nodesEqual } from '../utils/nodeDiff';
import type { PanelKey } from '../components/builder/MechanicNodeCard';

export type NodeChangeKind = 'modified' | 'renamed' | 'new';

// How a node differs from its last-fetched (pristine) copy, or null if it doesn't.
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
  // Node/fields to highlight in JsonOutputPane -- hover-driven, independent of
  // highlightedNodeId (summary row only).
  hoveredFieldHighlight: { nodeId: string; fields: string[] } | null;
  // Which sub-panel (if any) is open per node. Stored here, not in MechanicNodeCard, because a
  // rename re-keys `mechanics` and remounts the card under its new id. Keyed by node id and
  // migrated in renameMechanicNode.
  openPanelByNode: Record<string, PanelKey>;
  // Current id -> original (pristine) id, for renamed nodes -- lets a per-row revert find the
  // original after the rename re-keyed it. Persisted with the edit log.
  renamedFrom: Record<string, string>;
  // Edit log for every entity ever edited, not just the active one.
  // setActiveChar replays these onto each fresh fetch when an entity opens.
  // `mechanics`/`baseStats` below are just the active entity's working copy.
  editedBaseStats: Record<string, BaseStats>;
  editedMechanics: Record<string, MechanicNode>;
  deletedMechanicIds: string[];
  setHighlightedNodeId: (nodeId: string | null) => void;
  setHoveredFieldHighlight: (highlight: { nodeId: string; fields: string[] } | null) => void;
  setOpenPanel: (nodeId: string, panel: PanelKey | null) => void;
  setActiveChar: (charName: string | null, folder?: string, rarity?: number) => Promise<void>;
  setBaseStat: (key: string, value: any) => void;
  // Replaces the whole baseStats object at once -- e.g. importing a Character JSON file,
  // where stale fields the import doesn't redefine shouldn't linger from the old value.
  setAllBaseStats: (stats: BaseStats) => void;
  // insertAfter: for a brand-new nodeId only -- places it right after that existing key instead
  // of the object-spread default of the very end, so e.g. a Hold's freshly-created Repeat/Release
  // sibling lands next to its Hold in the saved JSON instead of miles away at EOF.
  setMechanicNode: (nodeId: string, node: MechanicNode, insertAfter?: string) => void;
  renameMechanicNode: (oldId: string, newId: string, node: MechanicNode) => void;
  removeMechanicNode: (nodeId: string) => void;
  // Moves an existing node's key next to targetId (drag-and-drop reorder in the Builder's
  // summary table) -- content is untouched, only its position in `mechanics` (and so the
  // exported JSON's key order) changes. No-op for an unknown id or dropping onto itself.
  reorderMechanicNode: (nodeId: string, targetId: string, position: 'before' | 'after') => void;
  // Restores one node to its pristine copy (or drops it if it never existed there). Returns false
  // if a renamed node's original id is now taken by another row.
  revertMechanicNode: (nodeId: string) => boolean;
  resetCache: () => void;
  // Drives the "!" dirty badge on a grid card without switching to it first.
  hasChanges: (itemName: string) => boolean;
  // Drops itemName's edit log (DataLoader untouched). Used by dataFreshness.ts to discard
  // local edits when the server JSON changed.
  discardChanges: (itemName: string) => void;
  // Slices the edit log down to just `itemNames`, for the calc worker's roster overrides.
  getTeamOverrides: (itemNames: string[]) => {
    editedBaseStats: Record<string, BaseStats>;
    editedMechanics: Record<string, MechanicNode>;
    deletedMechanicIds: string[];
  };
}

// A copy of `record` without `keys`.
const omit = <T,>(record: Record<string, T>, ...keys: string[]): Record<string, T> => {
  const copy = { ...record };
  keys.forEach(key => delete copy[key]);
  return copy;
};

// The entries of `record` whose id doesn't belong to `entityName`.
const omitEntity = <T,>(record: Record<string, T>, entityName: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([id]) => !MechanicKey.belongsTo(id, entityName)));

// The edit log with everything `entityName` ever edited forgotten.
const withoutEntityEdits = (state: BuilderState, entityName: string) => ({
  editedBaseStats: omit(state.editedBaseStats, entityName),
  editedMechanics: omitEntity(state.editedMechanics, entityName),
  deletedMechanicIds: state.deletedMechanicIds.filter(id => !MechanicKey.belongsTo(id, entityName)),
  renamedFrom: omitEntity(state.renamedFrom, entityName)
});

// New base stats for the open entity. Written straight onto the live DataLoader entry too (so
// Gauge and friends see it without a reload), and logged as an edit.
const withBaseStats = (state: BuilderState, baseStats: BaseStats) => {
  if (!state.activeChar) return { baseStats };
  const target = DataLoader.baseStatsFor(state.activeChar);
  if (target) Object.assign(target, baseStats);
  return { baseStats, editedBaseStats: { ...state.editedBaseStats, [state.activeChar]: baseStats } };
};

// Guards against a stale in-flight setActiveChar call resolving after the user navigated away.
let activeCharRequestSeq = 0;

// Maps a grid section's image folder to DataLoader's mechanic folder name.
// Shared by setActiveChar, resetCache, and dataFreshness.ts's staleness check.
export const mechFolderFor = (folder: string): EntityFolder => {
  const lower = folder.toLowerCase();
  if (lower === 'weapons') return 'weapons';
  if (lower === 'echo sets' || lower === 'sets') return 'sets';
  if (lower === 'echoes') return 'echoes';
  if (lower === 'system') return 'system';
  return 'characters';
};

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

        // A newer call already landed while this load was in flight -- let it win.
        if (requestId !== activeCharRequestSeq) return;

        // Replay cached edits onto the pristine fetch -- must run after loadMechanic, which
        // overwrites mechanicsDB with pristine JSON.
        const { editedBaseStats, editedMechanics, deletedMechanicIds } = get();
        const charEdits = editedBaseStats[charName];
        if (charEdits) {
          const target = DataLoader.baseStatsFor(charName);
          if (target) Object.assign(target, charEdits);
        }
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

      setMechanicNode: (nodeId, node, insertAfter) => {
        set(state => {
          let updated: Record<string, MechanicNode>;
          // Only a genuinely new key needs positioning -- updating one already in place should
          // never jump it elsewhere in the object.
          if (insertAfter && !(nodeId in state.mechanics) && insertAfter in state.mechanics) {
            updated = {};
            Object.entries(state.mechanics).forEach(([key, val]) => {
              updated[key] = val;
              if (key === insertAfter) updated[nodeId] = node;
            });
          } else {
            updated = { ...state.mechanics, [nodeId]: node };
          }
          DataLoader.registerMechanicNode(nodeId, node);
          // An edit identical to the pristine copy isn't an edit; keep it out of the log so
          // hasChanges, the header strip, and worker overrides ignore it.
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
          // Swaps keys in place to preserve property insertion order instead of appending to the end via delete/reassign.
          const updated: Record<string, MechanicNode> = {};
          Object.entries(state.mechanics).forEach(([key, val]) => {
            if (key === oldId) updated[newId] = node;
            else updated[key] = val;
          });
          DataLoader.unregisterMechanicNode(oldId);
          DataLoader.registerMechanicNode(newId, node);

          const updatedEdits = { ...omit(state.editedMechanics, oldId), [newId]: node };

          // Carries the open sub-panel across the id swap (MechanicNodeCard remounts under newId).
          const updatedOpenPanel = { ...state.openPanelByNode };
          if (updatedOpenPanel[oldId] !== undefined) {
            updatedOpenPanel[newId] = updatedOpenPanel[oldId];
            delete updatedOpenPanel[oldId];
          }

          // Chains through earlier renames so it always points at the pristine original; renaming
          // back to that original clears the link.
          const origin = state.renamedFrom[oldId] ?? oldId;
          const updatedRenamed = omit(state.renamedFrom, oldId);
          if (newId !== origin && DataLoader.pristineMechanics[origin]) updatedRenamed[newId] = origin;
          // Back at the original id with identical content isn't an edit.
          if (newId === origin && nodesEqual(node, DataLoader.pristineMechanics[origin])) delete updatedEdits[newId];

          return {
            mechanics: updated,
            editedMechanics: updatedEdits,
            openPanelByNode: updatedOpenPanel,
            renamedFrom: updatedRenamed,
            // Record oldId as deleted so a future re-fetch doesn't resurrect it from pristine data.
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
            if (key === nodeId) return; // re-inserted at its new spot below, not its old one
            if (key === targetId && position === 'before') updated[nodeId] = node;
            updated[key] = val;
            if (key === targetId && position === 'after') updated[nodeId] = node;
          });
          return {
            mechanics: updated,
            // Content is unchanged, but the saved JSON's key order is -- flag it like any other
            // edit so Export/the dirty badge pick it up.
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
          // Swaps in place (like rename) so the row keeps its position.
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
        const hadBaseStatEdit = !!get().editedBaseStats[itemName];
        const isActive = get().activeChar === itemName;
        const isWeapon = !!DataLoader.weaponDB[itemName];
        set(state => ({
          ...withoutEntityEdits(state, itemName),
          ...(isActive ? { baseStats: {}, mechanics: {} } : {})
        }));
        // setBaseStat/setAllBaseStats write straight onto the live DataLoader entry (see
        // withBaseStats) -- undo that here too, or a discarded edit keeps showing up outside
        // the Builder (e.g. Gauge.tsx's forte-dial count) until a full page reload. Only the
        // active entity's DataLoader entry can carry a live edit in the first place.
        if (hadBaseStatEdit && isActive) {
          DataLoader.loadMergedDB<Record<string, any>>(isWeapon ? 'db_weapons.json' : 'db_characters.json').then(fresh => {
            const pristine = fresh[itemName];
            const target = DataLoader.baseStatsFor(itemName);
            if (!pristine || !target) return;
            Object.keys(target).forEach(k => delete (target as any)[k]);
            Object.assign(target, pristine);
            if (get().activeChar === itemName) set({ baseStats: { ...pristine } });
          });
        }
      },

      getTeamOverrides: itemNames => {
        const { editedBaseStats, editedMechanics, deletedMechanicIds } = get();
        const names = new Set(itemNames);
        const matchesAny = (id: string) => itemNames.some(name => MechanicKey.belongsTo(id, name));
        return {
          editedBaseStats: Object.fromEntries(Object.entries(editedBaseStats).filter(([name]) => names.has(name))),
          // Strips _compiledRule (a cached live function) -- can't cross postMessage to the
          // worker, and gets recompiled there anyway.
          editedMechanics: Object.fromEntries(
            Object.entries(editedMechanics)
              .filter(([id]) => matchesAny(id))
              .map(([id, node]) => {
                const { _compiledRule, ...rest } = node as any;
                return [id, rest];
              })
          ),
          deletedMechanicIds: deletedMechanicIds.filter(matchesAny)
        };
      },

      resetCache: async () => {
        const { activeChar, activeFolder, activeRarity } = get();
        if (!activeChar) return;

        const mechFolder = mechFolderFor(activeFolder);

        DataLoader.clearMechanicCache(mechFolder, activeChar);
        await DataLoader.initDatabases();

        // Also clear this entity's edit log, or setActiveChar below just replays the same
        // edits back onto the refetched data.
        set(state => ({ baseStats: {}, mechanics: {}, ...withoutEntityEdits(state, activeChar) }));
        await get().setActiveChar(activeChar, activeFolder, activeRarity);
      }
    }),
    {
      name: 'wuwa_builder_cache',
      storage: persistStorage(),
      // `mechanics`/`baseStats` excluded -- derived (pristine data + edits replayed via
      // setActiveChar), not part of the durable edit log. Persisting them verbatim used to
      // re-inject stale keys on reload; re-deriving always re-fetches fresh instead.
      partialize: (state) => ({
        activeChar: state.activeChar,
        activeFolder: state.activeFolder,
        activeRarity: state.activeRarity,
        editedBaseStats: state.editedBaseStats,
        editedMechanics: state.editedMechanics,
        deletedMechanicIds: state.deletedMechanicIds,
        renamedFrom: state.renamedFrom
      })
    }
  )
);