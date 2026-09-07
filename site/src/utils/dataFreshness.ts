// Cheap "is my already-loaded data still current" checks built on DataLoader's manifest
// (public/data/manifest.json, a relPath -> content-hash map), guarding against the site's data
// files changing on the server while the SPA is left open.
//
// A changed entity is safe to silently evict UNLESS the user has local unsaved edits to it in
// the Mechanics Builder (useBuilderStore.hasChanges), in which case it's surfaced through
// useFreshnessConflictStore for a conflict dialog instead. Rankings' results files have no
// Builder-editable counterpart, so they're always just silently evicted.
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
  // Drops local edit logs and evicts from DataLoader so the next load picks up the server
  // version. Reloads the Builder's currently-open entity first if it was one of them.
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

// Compares each candidate's recorded loadedHash against a fresh manifest, silently evicting
// anything changed-and-unedited (returned so a caller with its own separate cache, e.g. the calc
// worker's DataLoader instance, can mirror the eviction), and raising anything locally edited.
async function checkItems(items: FreshnessItem[]): Promise<FreshnessItem[]> {
  if (items.length === 0) return [];
  const manifest = await DataLoader.refreshManifest();
  const conflicts: FreshnessItem[] = [];
  const evicted: FreshnessItem[] = [];

  for (const { folder, itemName } of items) {
    const cacheKey = DataLoader.mechanicCacheKey(folder, itemName);
    if (!DataLoader.cache.mechanics.has(cacheKey)) continue; // never loaded -- nothing to check

    const relPath = DataLoader.mechanicPath(folder, itemName);
    const latestHash = manifest[relPath];
    if (!latestHash) continue; // manifest doesn't know this path (e.g. it 404'd) -- nothing to compare against

    const knownHash = DataLoader.loadedHashes[relPath];
    if (!knownHash) {
      // Loaded before a manifest baseline existed -- adopt the current hash as that baseline.
      DataLoader.loadedHashes[relPath] = latestHash;
      continue;
    }
    if (knownHash === latestHash) continue; // unchanged

    const builderItemName = folder === 'generic' ? 'Generic' : itemName;
    if (useBuilderStore.getState().hasChanges(builderItemName)) {
      conflicts.push({ folder, itemName });
    } else {
      // Evict then immediately re-fetch, or the Rotation Row's Action dropdown would blank
      // out until something else happens to call loadMechanic again.
      DataLoader.clearMechanicCache(folder, itemName);
      await DataLoader.loadMechanic(folder, itemName);
      evicted.push({ folder, itemName });
    }
  }

  if (conflicts.length > 0) useFreshnessConflictStore.getState().raise(conflicts);
  return evicted;
}

// Every mechanic loaded for a team's characters/weapons/sets/echoes, plus the always-loaded
// 'generic' system mechanics. Returns whichever were evicted so a Calculate press can also tell
// the calc worker's own separate DataLoader instance to drop the same entries.
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

// Checked before the Mechanics Builder opens an entity, and on every reload/refocus/poll
// re-check of whatever's open (App.tsx's refreshActiveBuilderItem). Returns whichever items
// were evicted (empty when nothing changed), so a caller can skip an unnecessary setActiveChar
// replay -- which would otherwise re-trigger JsonOutputPane's highlight effect on every poll.
export async function checkBuilderItemFreshness(folder: string, itemName: string): Promise<FreshnessItem[]> {
  return checkItems([{ folder, itemName }]);
}

// No Builder-editable counterpart for results files, so anything changed is just silently
// evicted from DataLoader.characterResults. Returns whether anything was evicted, so the
// caller (useRankingsStore.load) knows to force a re-load even if status already says 'ready'.
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
