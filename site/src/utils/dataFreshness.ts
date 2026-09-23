// Cheap "is my loaded data still current" checks, built on DataLoader's manifest
// (relPath -> content hash). Guards against server data changing while the SPA stays open.
//
// A changed entity is safe to evict, unless the user has unsaved Builder edits to it
// (useBuilderStore.hasChanges) -- then it surfaces via useFreshnessConflictStore instead.
// Ranking files have no Builder counterpart, so they're always silently evicted.
import { create } from 'zustand';
import { DataLoader, RANKINGS_DIR } from './DataLoader';
import { getTeamEntityRefs } from './TeamUtils';
import { useBuilderStore } from '../store/useBuilderStore';
import type { TeamSlot, EntityRef, EntityFolder } from '../types';

interface FreshnessConflictState {
  conflicts: EntityRef[];
  raise: (items: EntityRef[]) => void;
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

// Compares loadedHash against a fresh manifest. Evicts changed-and-unedited items (returned
// so a separate cache, e.g. the calc worker's DataLoader, can mirror it) and raises edited ones.
async function checkItems(items: EntityRef[]): Promise<EntityRef[]> {
  if (items.length === 0) return [];
  const manifest = await DataLoader.refreshManifest();
  const conflicts: EntityRef[] = [];
  const evicted: EntityRef[] = [];

  for (const { folder, name } of items) {
    const cacheKey = DataLoader.mechanicCacheKey(folder, name);
    if (!DataLoader.cache.mechanics.has(cacheKey)) continue; // never loaded -- nothing to check

    const relPath = DataLoader.mechanicPath(folder, name);
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

    if (useBuilderStore.getState().hasChanges(name)) {
      conflicts.push({ folder, name });
    } else {
      // Evict then re-fetch immediately, or the Action dropdown blanks until something else calls loadMechanic.
      DataLoader.clearMechanicCache(folder, name);
      await DataLoader.loadMechanic(folder, name);
      evicted.push({ folder, name });
    }
  }

  if (conflicts.length > 0) useFreshnessConflictStore.getState().raise(conflicts);
  return evicted;
}

// Loads every mechanic for the team (chars/weapons/sets/echoes) plus System mechanics.
// Returns evicted items, so Calculate can mirror the drop in the calc worker's own DataLoader.
export async function checkTeamFreshness(team: TeamSlot[]): Promise<EntityRef[]> {
  return checkItems(getTeamEntityRefs(team, { includeSystem: true, dedupe: true }));
}

// Checked before the Builder opens an entity, and on every reload/refocus poll of what's open
// (App.tsx's refreshActiveBuilderItem). Returns evicted items (empty if unchanged), so callers
// can skip a setActiveChar replay that would re-trigger JsonOutputPane's highlight effect.
export async function checkBuilderItemFreshness(folder: EntityFolder, name: string): Promise<EntityRef[]> {
  return checkItems([{ folder, name }]);
}

// Ranking files have no Builder counterpart -- changes just evict them from DataLoader's caches.
// True when the index itself changed, so Rankings needs a full reload.
export async function checkResultsFreshness(): Promise<boolean> {
  const manifest = await DataLoader.refreshManifest();
  const changedSinceLoad = (relPath: string) => {
    const known = DataLoader.loadedHashes[relPath];
    return !!known && !!manifest[relPath] && known !== manifest[relPath];
  };

  if (changedSinceLoad(`${RANKINGS_DIR}/index.json`)) {
    DataLoader.rankingIndex = null;
    DataLoader.rankedRuns = {};
    return true;
  }
  // A run is two files; either changing means refetching both.
  (DataLoader.rankingIndex || []).forEach(entry => {
    if (changedSinceLoad(`${RANKINGS_DIR}/results/${entry.id}`) || changedSinceLoad(`${RANKINGS_DIR}/rotations/${entry.rotationFile}`)) {
      delete DataLoader.rankedRuns[entry.id];
    }
  });
  return false;
}
