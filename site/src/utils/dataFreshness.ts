// Checks loaded data against the manifest. Changed entities are evicted, unless they
// have Builder edits, which raise a conflict instead.
import { create } from 'zustand';
import { DataLoader, RANKINGS_DIR } from './DataLoader';
import { getTeamEntityRefs } from './TeamUtils';
import { useBuilderStore } from '../store/useBuilderStore';
import type { TeamSlot, EntityRef, EntityFolder } from '../types';

interface FreshnessConflictState {
  conflicts: EntityRef[];
  raise: (items: EntityRef[]) => void;
  // Keep edits.
  keep: () => void;
  // Drop edits and reload from the server.
  discard: () => Promise<void>;
}

// Session-only conflict prompt.
export const useFreshnessConflictStore = create<FreshnessConflictState>((set, get) => ({
  conflicts: [],

  raise: items => set(state => {
    const seen = new Set(state.conflicts.map(c => `${c.folder}/${c.name}`));
    const merged = [...state.conflicts];
    items.forEach(item => {
      const key = `${item.folder}/${item.name}`;
      if (!seen.has(key)) { seen.add(key); merged.push(item); }
    });
    return { conflicts: merged };
  }),

  keep: () => set({ conflicts: [] }),

  discard: async () => {
    const { conflicts } = get();
    conflicts.forEach(({ folder, name }) => {
      useBuilderStore.getState().discardChanges(name);
      DataLoader.clearMechanicCache(folder, name);
    });
    set({ conflicts: [] });

    const { activeChar, activeFolder, activeRarity, setActiveChar } = useBuilderStore.getState();
    if (activeChar && conflicts.some(c => c.name === activeChar)) {
      await setActiveChar(activeChar, activeFolder, activeRarity);
    }
  }
}));

// Reloads changed, unedited items (returned) and raises a conflict for edited ones.
async function checkItems(items: EntityRef[]): Promise<EntityRef[]> {
  if (items.length === 0) return [];
  await DataLoader.refreshManifest();
  const conflicts: EntityRef[] = [];
  const evicted: EntityRef[] = [];

  for (const { folder, name } of items) {
    if (!DataLoader.mechanicChanged(folder, name)) continue;

    if (useBuilderStore.getState().hasChanges(name)) {
      conflicts.push({ folder, name });
    } else {
      // Re-fetch immediately so dropdowns don't blank.
      DataLoader.clearMechanicCache(folder, name);
      await DataLoader.loadMechanic(folder, name);
      evicted.push({ folder, name });
    }
  }

  if (conflicts.length > 0) useFreshnessConflictStore.getState().raise(conflicts);
  return evicted;
}

export async function checkTeamFreshness(team: TeamSlot[]): Promise<void> {
  await checkItems(getTeamEntityRefs(team, { includeSystem: true, dedupe: true }));
}

// Returns evicted items (empty if unchanged).
export async function checkBuilderItemFreshness(folder: EntityFolder, name: string): Promise<EntityRef[]> {
  return checkItems([{ folder, name }]);
}

// Evicts changed ranking files. True when the index changed.
export async function checkResultsFreshness(): Promise<boolean> {
  await DataLoader.refreshManifest();
  const changedSinceLoad = (relPath: string) => {
    const known = DataLoader.loadedHashes[relPath];
    const latest = DataLoader.currentHash(relPath);
    return !!known && !!latest && known !== latest;
  };

  if (changedSinceLoad(`${RANKINGS_DIR}/index.json`)) {
    DataLoader.rankingIndex = null;
    DataLoader.rankedRuns = {};
    DataLoader.rankedResults = {};
    return true;
  }
  (DataLoader.rankingIndex || []).forEach(entry => {
    if (changedSinceLoad(`${RANKINGS_DIR}/results/${entry.id}`) || changedSinceLoad(`${RANKINGS_DIR}/rotations/${entry.rotationFile}`)) {
      delete DataLoader.rankedRuns[entry.id];
      delete DataLoader.rankedResults[entry.id];
    }
  });
  return false;
}
