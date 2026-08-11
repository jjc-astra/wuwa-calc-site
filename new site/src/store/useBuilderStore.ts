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
  setHighlightedNodeId: (nodeId: string | null) => void;
  setActiveChar: (charName: string | null, folder?: string, rarity?: number) => Promise<void>;
  setBaseStat: (key: string, value: any) => void;
  setMechanicNode: (nodeId: string, node: MechanicNode) => void;
  renameMechanicNode: (oldId: string, newId: string, node: MechanicNode) => void;
  removeMechanicNode: (nodeId: string) => void;
  resetCache: () => void;
}

// Guards against a stale in-flight setActiveChar call (e.g. a slow character load)
// resolving after the user has already navigated elsewhere (or hit "Back to Library")
// and clobbering whatever the more recent call decided.
let activeCharRequestSeq = 0;

export const useBuilderStore = create<BuilderState>()(
  persist(
    (set, get) => ({
      activeChar: null,
      activeFolder: IMAGE_FOLDERS.CHARACTERS,
      activeRarity: 5,
      baseStats: {},
      mechanics: {},
      highlightedNodeId: null,
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

        const loadedStats = DataLoader.characterDB[charName] || DataLoader.weaponDB[charName] || {};
        const loadedMechs: Record<string, MechanicNode> = {};

        Object.keys(DataLoader.mechanicsDB).forEach(key => {
          if (key.startsWith(charName + '_') || (charName === 'Generic' && key.startsWith('System_'))) {
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
        set(state => ({
          baseStats: { ...state.baseStats, [key]: value }
        }));
      },

      setMechanicNode: (nodeId, node) => {
        set(state => {
          const updated = { ...state.mechanics, [nodeId]: node };
          DataLoader.mechanicsDB[nodeId] = node;
          return { mechanics: updated };
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
          return { mechanics: updated };
        });
      },

      removeMechanicNode: nodeId => {
        set(state => {
          const updated = { ...state.mechanics };
          delete updated[nodeId];
          delete DataLoader.mechanicsDB[nodeId];
          return { mechanics: updated };
        });
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

        // 3. Clear store state and re-initialize from fresh JSON
        set({ baseStats: {}, mechanics: {} });
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