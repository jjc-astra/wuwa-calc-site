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
  // Which node + JSON field names to highlight in JsonOutputPane -- purely hover-driven,
  // independent of highlightedNodeId (which stays scoped to the summary row alone so the
  // whole-node highlight doesn't also light up while the mouse is just over a specific cell or
  // resting inside the open sub-panel's own inputs). Set while the mouse is over a summary-row
  // cell that opens a given sub-panel (even if that panel isn't open) OR the currently-open
  // panel's own body -- both resolve to the same PanelKey -> fields mapping (MechanicNodeCard's
  // PANEL_FIELDS), so hovering either one previews exactly what that panel edits.
  hoveredFieldHighlight: { nodeId: string; fields: string[] } | null;
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
  setHoveredFieldHighlight: (highlight: { nodeId: string; fields: string[] } | null) => void;
  setActiveChar: (charName: string | null, folder?: string, rarity?: number) => Promise<void>;
  setBaseStat: (key: string, value: any) => void;
  setMechanicNode: (nodeId: string, node: MechanicNode) => void;
  renameMechanicNode: (oldId: string, newId: string, node: MechanicNode) => void;
  removeMechanicNode: (nodeId: string) => void;
  resetCache: () => void;
  // True if `itemName` (character/weapon/set/echo/'Generic') has any locally-cached edit --
  // drives the "!" dirty badge on its grid card without needing to switch to it first.
  hasChanges: (itemName: string) => boolean;
  // Drops itemName's local edit log (baseStats + mechanics + deletions) without touching
  // DataLoader -- used by src/utils/dataFreshness.ts when a manifest staleness check finds the
  // underlying JSON changed on the server *and* the user chose to discard local edits in favor
  // of the new version. If itemName is the currently-open entity, also clears the live working
  // copy so the Builder UI doesn't keep showing the discarded edits.
  discardChanges: (itemName: string) => void;
  // Slices the full edit log down to just the entities named in `itemNames` -- used to hand
  // the Rotation Calculator's calc worker only the overrides relevant to whatever's actually
  // in the current roster (see useRotationStore.ts), not the builder's entire edit history.
  getTeamOverrides: (itemNames: string[]) => {
    editedBaseStats: Record<string, BaseStats>;
    editedMechanics: Record<string, MechanicNode>;
    deletedMechanicIds: string[];
  };
}

// Guards against a stale in-flight setActiveChar call (e.g. a slow character load)
// resolving after the user has already navigated elsewhere (or hit "Back to Library")
// and clobbering whatever the more recent call decided.
let activeCharRequestSeq = 0;

// Mirrors the charName+'_' (or 'Generic'->'System_') prefix convention DataLoader.loadMechanic/
// clearMechanicCache already use for scoping mechanicsDB keys to one entity.
export const nodeIdPrefix = (itemName: string) => (itemName === 'Generic' ? 'System_' : `${itemName}_`);

// Maps a builder grid section's image folder (IMAGE_FOLDERS.* / the 'System' entry) to the
// DataLoader.loadMechanic/clearMechanicCache folder name -- shared by setActiveChar, resetCache
// below, and dataFreshness.ts's pre-open staleness check, which all need the exact same mapping.
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
          // setMechanicNode stores this exact node object into DataLoader.mechanicsDB too, and
          // the Rotation Calculator's dropdown legality-check (RotationRow.tsx's checkValid)
          // mutates DataLoader.mechanicsDB entries in place, caching a compiled trigger-rule
          // function onto them as `_compiledRule` -- so a node edited in the Builder can pick up
          // a live function reference this way. Strip it back out here (it gets recompiled for
          // free on the worker side anyway -- see TimelineEngine._getModifiedMoveData) since
          // this payload is about to cross the postMessage boundary into the calc worker, which
          // can't structured-clone a function.
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
      // `mechanics`/`baseStats` are excluded on purpose -- they're the current entity's *derived*
      // live working copy (fresh pristine DataLoader data + editedMechanics/editedBaseStats
      // replayed on top, see setActiveChar), not part of the durable edit log themselves.
      // Persisting and replaying them verbatim used to re-inject whatever pristine keys existed
      // at snapshot time straight into DataLoader.mechanicsDB on every reload -- including ones
      // since removed from the source JSON on disk, since that's an additive Object.assign with
      // nothing to prune a since-deleted key. A manifest/file change would then never fix it
      // (DataLoader itself was never asked to re-fetch that entity in the first place), and only
      // Reset Cache's explicit clearMechanicCache -- which this rehydration path bypassed -- ever
      // pruned it. Persisting only editedMechanics/editedBaseStats/deletedMechanicIds (the actual
      // edit log) and always re-deriving `mechanics`/`baseStats` from a live setActiveChar call
      // means every reload naturally goes through the same fresh-fetch + freshness-check path a
      // first-ever visit does.
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