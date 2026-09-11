// Cheap "is my loaded data still current" checks, built on DataLoader's manifest
// (relPath -> content hash). Guards against server data changing while the SPA stays open.
//
// A changed entity is safe to evict, unless the user has unsaved Builder edits to it
// (useBuilderStore.hasChanges) -- then it surfaces via useFreshnessConflictStore instead.
// Results files have no Builder counterpart, so they're always silently evicted.
import { create } from 'zustand';
import { DataLoader } from './DataLoader';
import { useBuilderStore } from '../store/useBuilderStore';
import type { TeamSlot } from '../types';

export interface FreshnessItem {
  folder: string;
  itemName: string;
}

interface FreshnessConflictState {
  conflicts: FreshnessItem[];
  raise: (items: FreshnessItem[]) => void;
  // Dismiss without touching anything -- edits stay until the user retriggers a check.
  keep: () => void;
  // Drops local edit logs, evicts from DataLoader so the next load gets the server version.
  // Reloads the Builder's open entity first, if it was one of them.
  discard: () => Promise<void>;
}

// Not persisted -- a conflict is a live, session-only prompt, drives the one dialog at the App root.
export const useFreshnessConflictStore = create<FreshnessConflictState>((set, get) => ({
  conflicts: [],

  raise: items => set(state => {
    const seen = new Set(state.conflicts.map(c => `${c.folder}/${c.itemName}`));
    const merged = [...state.conflicts];
    items.forEach(item => {
      const key = `${item.folder}/${item.itemName}`;
      if (!seen.has(key)) { seen.add(key); merged.push(item); }
    });
    return { conflicts: merged };
  }),

  keep: () => set({ conflicts: [] }),

  discard: async () => {
    const { conflicts } = get();
    conflicts.forEach(({ folder, itemName }) => {
      useBuilderStore.getState().discardChanges(itemName);
      DataLoader.clearMechanicCache(folder, itemName);
    });
    set({ conflicts: [] });

    const { activeChar, activeFolder, activeRarity, setActiveChar } = useBuilderStore.getState();
    if (activeChar && conflicts.some(c => c.itemName === activeChar)) {
      await setActiveChar(activeChar, activeFolder, activeRarity);
    }
  }
}));

// Compares loadedHash against a fresh manifest. Evicts changed-and-unedited items (returned
// so a separate cache, e.g. the calc worker's DataLoader, can mirror it) and raises edited ones.
async function checkItems(items: FreshnessItem[]): Promise<FreshnessItem[]> {
  if (items.length === 0) return [];
  const manifest = await DataLoader.refreshManifest();
  const conflicts: FreshnessItem[] = [];
  const evicted: FreshnessItem[] = [];

  for (const { folder, itemName } of items) {
    const cacheKey = DataLoader.mechanicCacheKey(folder, itemName);
    if (!DataLoader.cache.mechanics.has(cacheKey)) continue; // never loaded -- nothing to check

    const relPath = DataLoader.mechanicPath(folder, itemName);
    if (DataLoader.wipSourced.has(relPath)) continue; // no manifest baseline applies -- WIP owns this until reloaded

    const latestHash = manifest[relPath];
    if (!latestHash) continue; // manifest lacks this path (e.g. 404'd) -- nothing to compare

    const knownHash = DataLoader.loadedHashes[relPath];
    if (!knownHash) {
      // Loaded before a manifest baseline existed -- adopt the current hash as that baseline.
      DataLoader.loadedHashes[relPath] = latestHash;
      continue;
    }
    if (knownHash === latestHash) continue;

    const builderItemName = folder === 'generic' ? 'Generic' : itemName;
    if (useBuilderStore.getState().hasChanges(builderItemName)) {
      conflicts.push({ folder, itemName });
    } else {
      // Evict then re-fetch immediately, or the Action dropdown blanks until something else calls loadMechanic.
      DataLoader.clearMechanicCache(folder, itemName);
      await DataLoader.loadMechanic(folder, itemName);
      evicted.push({ folder, itemName });
    }
  }

  if (conflicts.length > 0) useFreshnessConflictStore.getState().raise(conflicts);
  return evicted;
}

// Loads every mechanic for the team (chars/weapons/sets/echoes) plus 'generic' system mechanics.
// Returns evicted items, so Calculate can mirror the drop in the calc worker's own DataLoader.
export async function checkTeamFreshness(team: TeamSlot[]): Promise<FreshnessItem[]> {
  const items: FreshnessItem[] = [{ folder: 'generic', itemName: 'Generic' }];
  team.forEach(slot => {
    if (slot.character) items.push({ folder: 'characters', itemName: slot.character });
    if (slot.weapon) items.push({ folder: 'weapons', itemName: slot.weapon });
    if (slot.mainSet) items.push({ folder: 'sets', itemName: slot.mainSet });
    if (slot.subSet) items.push({ folder: 'sets', itemName: slot.subSet });
    if (slot.mainEcho) items.push({ folder: 'echoes', itemName: slot.mainEcho });
  });
  return checkItems(items);
}

// Checked before the Builder opens an entity, and on every reload/refocus poll of what's open
// (App.tsx's refreshActiveBuilderItem). Returns evicted items (empty if unchanged), so callers
// can skip a setActiveChar replay that would re-trigger JsonOutputPane's highlight effect.
export async function checkBuilderItemFreshness(folder: string, itemName: string): Promise<FreshnessItem[]> {
  return checkItems([{ folder, itemName }]);
}

// Results files have no Builder counterpart -- changes are just evicted from characterResults.
// Return value tells useRankingsStore.load to force a reload even when status says 'ready'.
export async function checkResultsFreshness(): Promise<boolean> {
  const manifest = await DataLoader.refreshManifest();
  const indexPath = 'character_results/index.json';

  const indexKnown = DataLoader.loadedHashes[indexPath];
  const indexLatest = manifest[indexPath];
  if (indexKnown && indexLatest && indexKnown !== indexLatest) {
    // Which results exist changed -- wipe everything rather than diffing the file list.
    DataLoader.characterResults = {};
    return true;
  }

  let changed = false;
  Object.keys(DataLoader.characterResults).forEach(filename => {
    const relPath = `character_results/${filename}`;
    const knownHash = DataLoader.loadedHashes[relPath];
    const latestHash = manifest[relPath];
    if (knownHash && latestHash && knownHash !== latestHash) {
      delete DataLoader.characterResults[filename];
      changed = true;
    }
  });
  return changed;
}
