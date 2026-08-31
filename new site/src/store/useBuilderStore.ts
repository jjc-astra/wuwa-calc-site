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
  // Persisted across EVERY character/weapon/set/echo ever edited in the builder, not just the
  // currently active one -- setActiveChar replays whatever's here (keyed by that entity's own
  // name/nodeId prefix) on top of a fresh pristine fetch each time it's opened, so switching
  // between several edited entities and reloading the page no longer loses anything but the
  // most-recently-active one. `mechanics`/`baseStats` above stay as the current entity's live
  // working copy (what the editor/JsonOutputPane actually render) -- these are the durable log.
  editedBaseStats: Record<string, BaseStats>;
  editedMechanics: Record<string, MechanicNode>;
  deletedMechanicIds: string[];
  setHighlightedNodeId: (nodeId: string | null) => void;
  setActiveChar: (charName: string | null, folder?: string, rarity?: number) => Promise<void>;
  setBaseStat: (key: string, value: any) => void;
  setMechanicNode: (nodeId: string, node: MechanicNode) => void;
  renameMechanicNode: (oldId: string, newId: string, node: MechanicNode) => void;
  removeMechanicNode: (nodeId: string) => void;
  resetCache: () => void;
  // True if `itemName` (character/weapon/set/echo/'Generic') has any locally-cached edit --
  // drives the "!" dirty badge on its grid card without needing to switch to it first.
  hasChanges: (itemName: string) => boolean;
}

// Guards against a stale in-flight setActiveChar call (e.g. a slow character load)
// resolving after the user has already navigated elsewhere (or hit "Back to Library")
// and clobbering whatever the more recent call decided.
let activeCharRequestSeq = 0;

// Mirrors the charName+'_' (or 'Generic'->'System_') prefix convention DataLoader.loadMechanic/
// clearMechanicCache already use for scoping mechanicsDB keys to one entity.
const nodeIdPrefix = (itemName: string) => (itemName === 'Generic' ? 'System_' : `${itemName}_`);

export const useBuilderStore = create<BuilderState>()(
  persist(
    (set, get) => ({
      activeChar: null,
      activeFolder: IMAGE_FOLDERS.CHARACTERS,
      activeRarity: 5,
      baseStats: {},
      mechanics: {},
      highlightedNodeId: null,
      editedBaseStats: {},
      editedMechanics: {},
      deletedMechanicIds: [],
      setHighlightedNodeId: (nodeId) => set({ highlightedNodeId: nodeId }),

      setActiveChar: async (charName, folder = IMAGE_FOLDERS.CHARACTERS, rarity = 5) => {
        const requestId = ++activeCharRequestSeq;

        if (!charName) {
          set({ activeChar: null });
          return;
        }

        let mechFolder = 'characters';
        const lowerFolder = folder.toLowerCase();
        if (lowerFolder === 'weapons') mechFolder = 'weapons';
        else if (lowerFolder === 'echo sets' || lowerFolder === 'sets') mechFolder = 'sets';
        else if (lowerFolder === 'echoes') mechFolder = 'echoes';
        else if (lowerFolder === 'system' || lowerFolder === 'generic') mechFolder = 'generic';

        await DataLoader.loadMechanic(mechFolder, charName);

        // A newer call (a different character, or "Back to Library") already landed while
        // this load was in flight -- let it win instead of snapping back over it.
        if (requestId !== activeCharRequestSeq) return;

        // Replay this entity's own cached edits on top of the just-fetched pristine data --
        // loadMechanic above always overwrites mechanicsDB with pristine JSON, so this has to
        // run after it (merging edits in before the fetch would just get clobbered by it).
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
            // Pristine data may still have oldId -- record it as deleted so a future re-fetch
            // (a fresh setActiveChar call, possibly next session) doesn't resurrect it.
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

      resetCache: async () => {
        const { activeChar, activeFolder, activeRarity } = get();
        if (!activeChar) return;

        let mechFolder = 'characters';
        const lowerFolder = activeFolder.toLowerCase();
        if (lowerFolder === 'weapons') mechFolder = 'weapons';
        else if (lowerFolder === 'echo sets' || lowerFolder === 'sets') mechFolder = 'sets';
        else if (lowerFolder === 'echoes') mechFolder = 'echoes';
        else if (lowerFolder === 'system' || lowerFolder === 'generic') mechFolder = 'generic';

        // 1. Evict item entries from DataLoader cache
        DataLoader.clearMechanicCache(mechFolder, activeChar);

        // 2. Re-fetch core character & weapon base stats JSON
        await DataLoader.initDatabases();

        // 3. Clear store state, including this entity's cached edit log -- otherwise the
        // setActiveChar call below would just replay the same edits right back on top of the
        // freshly-refetched pristine data.
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
      onRehydrateStorage: () => {
        return (state, error) => {
          if (!error && state) {
            if (state.mechanics) {
              Object.assign(DataLoader.mechanicsDB, state.mechanics);
            }
            if (state.activeChar && state.baseStats) {
              if (DataLoader.characterDB[state.activeChar]) {
                Object.assign(DataLoader.characterDB[state.activeChar], state.baseStats);
              } else if (DataLoader.weaponDB[state.activeChar]) {
                Object.assign(DataLoader.weaponDB[state.activeChar], state.baseStats);
              }
            }
          }
        };
      }
    }
  )
);