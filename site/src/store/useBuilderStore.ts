import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MechanicNode, BaseStats } from '../types';
import { DataLoader } from '../utils/DataLoader';
import { IMAGE_FOLDERS } from '../data/db';

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
  // Edit log for every entity ever edited, not just the active one.
  // setActiveChar replays these onto each fresh fetch when an entity opens.
  // `mechanics`/`baseStats` below are just the active entity's working copy.
  editedBaseStats: Record<string, BaseStats>;
  editedMechanics: Record<string, MechanicNode>;
  deletedMechanicIds: string[];
  setHighlightedNodeId: (nodeId: string | null) => void;
  setHoveredFieldHighlight: (highlight: { nodeId: string; fields: string[] } | null) => void;
  setActiveChar: (charName: string | null, folder?: string, rarity?: number) => Promise<void>;
  setBaseStat: (key: string, value: any) => void;
  // Replaces the whole baseStats object at once -- e.g. importing a Character JSON file,
  // where stale fields the import doesn't redefine shouldn't linger from the old value.
  setAllBaseStats: (stats: BaseStats) => void;
  setMechanicNode: (nodeId: string, node: MechanicNode) => void;
  renameMechanicNode: (oldId: string, newId: string, node: MechanicNode) => void;
  removeMechanicNode: (nodeId: string) => void;
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

// Guards against a stale in-flight setActiveChar call resolving after the user navigated away.
let activeCharRequestSeq = 0;

// Mirrors DataLoader.loadMechanic/clearMechanicCache's own prefix convention for mechanicsDB keys.
export const nodeIdPrefix = (itemName: string) => (itemName === 'Generic' ? 'System_' : `${itemName}_`);

// Maps a grid section's image folder to DataLoader's mechanic folder name.
// Shared by setActiveChar, resetCache, and dataFreshness.ts's staleness check.
export const mechFolderFor = (folder: string): string => {
  const lower = folder.toLowerCase();
  if (lower === 'weapons') return 'weapons';
  if (lower === 'echo sets' || lower === 'sets') return 'sets';
  if (lower === 'echoes') return 'echoes';
  if (lower === 'system' || lower === 'generic') return 'generic';
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
      editedBaseStats: {},
      editedMechanics: {},
      deletedMechanicIds: [],
      setHighlightedNodeId: (nodeId) => set({ highlightedNodeId: nodeId }),
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
        const prefix = nodeIdPrefix(charName);
        const charEdits = editedBaseStats[charName];
        if (charEdits) {
          const target = DataLoader.characterDB[charName] || DataLoader.weaponDB[charName];
          if (target) Object.assign(target, charEdits);
        }
        Object.entries(editedMechanics).forEach(([id, node]) => {
          if (id.startsWith(prefix)) DataLoader.registerMechanicNode(id, node);
        });
        deletedMechanicIds.forEach(id => {
          if (id.startsWith(prefix)) DataLoader.unregisterMechanicNode(id);
        });

        const loadedStats = DataLoader.characterDB[charName] || DataLoader.weaponDB[charName] || {};
        const loadedMechs: Record<string, MechanicNode> = {};

        Object.keys(DataLoader.mechanicsDB).forEach(key => {
          if (key.startsWith(prefix)) {
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

      setBaseStat: (key, value) => {
        set(state => {
          if (!state.activeChar) return { baseStats: { ...state.baseStats, [key]: value } };
          const nextBaseStats = { ...state.baseStats, [key]: value };
          const target = DataLoader.characterDB[state.activeChar] || DataLoader.weaponDB[state.activeChar];
          if (target) Object.assign(target, nextBaseStats);
          return {
            baseStats: nextBaseStats,
            editedBaseStats: { ...state.editedBaseStats, [state.activeChar]: nextBaseStats }
          };
        });
      },

      setAllBaseStats: stats => {
        set(state => {
          if (!state.activeChar) return { baseStats: stats };
          const target = DataLoader.characterDB[state.activeChar] || DataLoader.weaponDB[state.activeChar];
          if (target) Object.assign(target, stats);
          return {
            baseStats: stats,
            editedBaseStats: { ...state.editedBaseStats, [state.activeChar]: stats }
          };
        });
      },

      setMechanicNode: (nodeId, node) => {
        set(state => {
          const updated = { ...state.mechanics, [nodeId]: node };
          DataLoader.registerMechanicNode(nodeId, node);
          return {
            mechanics: updated,
            editedMechanics: { ...state.editedMechanics, [nodeId]: node },
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
          const updated = { ...state.mechanics };
          delete updated[oldId];
          updated[newId] = node;
          DataLoader.unregisterMechanicNode(oldId);
          DataLoader.registerMechanicNode(newId, node);

          const updatedEdits = { ...state.editedMechanics };
          delete updatedEdits[oldId];
          updatedEdits[newId] = node;

          return {
            mechanics: updated,
            editedMechanics: updatedEdits,
            // Record oldId as deleted so a future re-fetch doesn't resurrect it from pristine data.
            deletedMechanicIds: [...state.deletedMechanicIds.filter(id => id !== oldId && id !== newId), oldId]
          };
        });
      },

      removeMechanicNode: nodeId => {
        set(state => {
          const updated = { ...state.mechanics };
          delete updated[nodeId];
          DataLoader.unregisterMechanicNode(nodeId);

          const updatedEdits = { ...state.editedMechanics };
          delete updatedEdits[nodeId];

          return {
            mechanics: updated,
            editedMechanics: updatedEdits,
            deletedMechanicIds: [...state.deletedMechanicIds.filter(id => id !== nodeId), nodeId]
          };
        });
      },

      hasChanges: itemName => {
        const { editedBaseStats, editedMechanics, deletedMechanicIds } = get();
        if (editedBaseStats[itemName]) return true;
        const prefix = nodeIdPrefix(itemName);
        if (Object.keys(editedMechanics).some(id => id.startsWith(prefix))) return true;
        if (deletedMechanicIds.some(id => id.startsWith(prefix))) return true;
        return false;
      },

      discardChanges: itemName => {
        const prefix = nodeIdPrefix(itemName);
        const hadBaseStatEdit = !!get().editedBaseStats[itemName];
        const isActive = get().activeChar === itemName;
        const isWeapon = !!DataLoader.weaponDB[itemName];
        set(state => {
          const nextEditedBaseStats = { ...state.editedBaseStats };
          delete nextEditedBaseStats[itemName];
          const nextEditedMechanics = Object.fromEntries(
            Object.entries(state.editedMechanics).filter(([id]) => !id.startsWith(prefix))
          );
          const nextDeletedMechanicIds = state.deletedMechanicIds.filter(id => !id.startsWith(prefix));
          return {
            editedBaseStats: nextEditedBaseStats,
            editedMechanics: nextEditedMechanics,
            deletedMechanicIds: nextDeletedMechanicIds,
            ...(isActive ? { baseStats: {}, mechanics: {} } : {})
          };
        });
        // setBaseStat/setAllBaseStats write straight onto the live DataLoader entry (see
        // comment there) -- undo that here too, or a discarded edit keeps showing up outside
        // the Builder (e.g. Gauge.tsx's forte-dial count) until a full page reload. Only the
        // active entity's DataLoader entry can carry a live edit in the first place.
        if (hadBaseStatEdit && isActive) {
          DataLoader.loadMergedDB<Record<string, any>>(isWeapon ? 'db_weapons.json' : 'db_characters.json').then(fresh => {
            const pristine = fresh[itemName];
            const target = DataLoader.characterDB[itemName] || DataLoader.weaponDB[itemName];
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
        const prefixes = itemNames.map(nodeIdPrefix);
        const matchesAny = (id: string) => prefixes.some(p => id.startsWith(p));
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
        const prefix = nodeIdPrefix(activeChar);
        set(state => {
          const nextEditedBaseStats = { ...state.editedBaseStats };
          delete nextEditedBaseStats[activeChar];
          const nextEditedMechanics = Object.fromEntries(
            Object.entries(state.editedMechanics).filter(([id]) => !id.startsWith(prefix))
          );
          return {
            baseStats: {},
            mechanics: {},
            editedBaseStats: nextEditedBaseStats,
            editedMechanics: nextEditedMechanics,
            deletedMechanicIds: state.deletedMechanicIds.filter(id => !id.startsWith(prefix))
          };
        });
        await get().setActiveChar(activeChar, activeFolder, activeRarity);
      }
    }),
    {
      name: 'wuwa_builder_cache',
      // `mechanics`/`baseStats` excluded -- derived (pristine data + edits replayed via
      // setActiveChar), not part of the durable edit log. Persisting them verbatim used to
      // re-inject stale keys on reload; re-deriving always re-fetches fresh instead.
      partialize: (state) => ({
        activeChar: state.activeChar,
        activeFolder: state.activeFolder,
        activeRarity: state.activeRarity,
        editedBaseStats: state.editedBaseStats,
        editedMechanics: state.editedMechanics,
        deletedMechanicIds: state.deletedMechanicIds
      })
    }
  )
);