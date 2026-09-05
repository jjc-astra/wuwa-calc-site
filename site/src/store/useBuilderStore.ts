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
  // Which node + JSON field names to highlight in JsonOutputPane, purely hover-driven and
  // independent of highlightedNodeId (scoped to the summary row alone).
  hoveredFieldHighlight: { nodeId: string; fields: string[] } | null;
  // Persisted across every character/weapon/set/echo ever edited, not just the active one --
  // setActiveChar replays these on top of a fresh pristine fetch each time an entity opens.
  // `mechanics`/`baseStats` below stay as the current entity's live working copy.
  editedBaseStats: Record<string, BaseStats>;
  editedMechanics: Record<string, MechanicNode>;
  deletedMechanicIds: string[];
  setHighlightedNodeId: (nodeId: string | null) => void;
  setHoveredFieldHighlight: (highlight: { nodeId: string; fields: string[] } | null) => void;
  setActiveChar: (charName: string | null, folder?: string, rarity?: number) => Promise<void>;
  setBaseStat: (key: string, value: any) => void;
  setMechanicNode: (nodeId: string, node: MechanicNode) => void;
  renameMechanicNode: (oldId: string, newId: string, node: MechanicNode) => void;
  removeMechanicNode: (nodeId: string) => void;
  resetCache: () => void;
  // Drives the "!" dirty badge on a grid card without switching to it first.
  hasChanges: (itemName: string) => boolean;
  // Drops itemName's local edit log without touching DataLoader. Used by dataFreshness.ts when
  // the server JSON changed and the user chose to discard local edits.
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

// Maps a builder grid section's image folder to DataLoader's mechanic folder name. Shared by
// setActiveChar, resetCache, and dataFreshness.ts's staleness check.
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

        // Replay this entity's cached edits on top of the just-fetched pristine data (must
        // run after loadMechanic, which always overwrites mechanicsDB with pristine JSON).
        const { editedBaseStats, editedMechanics, deletedMechanicIds } = get();
        const prefix = nodeIdPrefix(charName);
        const charEdits = editedBaseStats[charName];
        if (charEdits) {
          const target = DataLoader.characterDB[charName] || DataLoader.weaponDB[charName];
          if (target) Object.assign(target, charEdits);
        }
        Object.entries(editedMechanics).forEach(([id, node]) => {
          if (id.startsWith(prefix)) DataLoader.mechanicsDB[id] = node;
        });
        deletedMechanicIds.forEach(id => {
          if (id.startsWith(prefix)) delete DataLoader.mechanicsDB[id];
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
          return {
            baseStats: nextBaseStats,
            editedBaseStats: { ...state.editedBaseStats, [state.activeChar]: nextBaseStats }
          };
        });
      },

      setMechanicNode: (nodeId, node) => {
        set(state => {
          const updated = { ...state.mechanics, [nodeId]: node };
          DataLoader.mechanicsDB[nodeId] = node;
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
          delete DataLoader.mechanicsDB[oldId];
          DataLoader.mechanicsDB[newId] = node;

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
          delete DataLoader.mechanicsDB[nodeId];

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
        set(state => {
          const nextEditedBaseStats = { ...state.editedBaseStats };
          delete nextEditedBaseStats[itemName];
          const nextEditedMechanics = Object.fromEntries(
            Object.entries(state.editedMechanics).filter(([id]) => !id.startsWith(prefix))
          );
          const nextDeletedMechanicIds = state.deletedMechanicIds.filter(id => !id.startsWith(prefix));
          const isActive = state.activeChar === itemName;
          return {
            editedBaseStats: nextEditedBaseStats,
            editedMechanics: nextEditedMechanics,
            deletedMechanicIds: nextDeletedMechanicIds,
            ...(isActive ? { baseStats: {}, mechanics: {} } : {})
          };
        });
      },

      getTeamOverrides: itemNames => {
        const { editedBaseStats, editedMechanics, deletedMechanicIds } = get();
        const names = new Set(itemNames);
        const prefixes = itemNames.map(nodeIdPrefix);
        const matchesAny = (id: string) => prefixes.some(p => id.startsWith(p));
        return {
          editedBaseStats: Object.fromEntries(Object.entries(editedBaseStats).filter(([name]) => names.has(name))),
          // Strips _compiledRule (a live function RotationRow.tsx's checkValid may have cached
          // onto the shared DataLoader node) since a function can't cross the postMessage
          // boundary into the calc worker; it gets recompiled there for free anyway.
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

        // 1. Evict item entries from DataLoader cache
        DataLoader.clearMechanicCache(mechFolder, activeChar);

        // 2. Re-fetch core character & weapon base stats JSON
        await DataLoader.initDatabases();

        // 3. Clear store state, including this entity's edit log (or setActiveChar below
        // would just replay the same edits back onto the freshly-refetched data).
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
      // `mechanics`/`baseStats` are excluded -- they're derived (pristine DataLoader data +
      // edits replayed on top via setActiveChar), not part of the durable edit log. Persisting
      // them verbatim used to re-inject stale pristine keys on reload with nothing to prune a
      // since-deleted one; re-deriving them always goes through the fresh-fetch path instead.
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