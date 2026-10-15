import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '../utils/safeLocalStorage';
import { DataLoader } from '../utils/DataLoader';
import { checkResultsFreshness } from '../utils/dataFreshness';
import type { RankingIndexEntry, DpsWindowKey } from '../types/results';
import { dpsFieldOf } from '../data/dpsWindows';
import { DEFAULT_RANKING_FILTERS, RANKING_ELEMENTS, RANKING_DMG_CATEGORIES } from '../components/rankings/RankingFilterToolbar';
import type { RankingFilters, RankingElement, RankingDmgCategory } from '../components/rankings/RankingFilterToolbar';

// A ranked rotation as listed in the index.
export type RankingEntry = RankingIndexEntry;

export const ROTATION_TYPE_LABELS = { linear: 'Linear', quickswap: 'Quickswap', unclassified: 'Unclassified' } as const;
export const rotationTypeLabel = (type: RankingEntry['rotationType']): string => ROTATION_TYPE_LABELS[type ?? 'unclassified'];

// Best Only grouping: same characters, slots and sequences.
function rotationGroupKey(entry: RankingEntry): string {
  return entry.characters.map((character, i) => `${character}@S${entry.sequences[i] ?? 0}`).join('|');
}

/** Filters, Best Only dedupe, then DPS-descending sort. */
export function filterRankingEntries(
  entries: RankingEntry[],
  filters: RankingFilters,
  search: string,
  activeWindow: DpsWindowKey
): RankingEntry[] {
  const searchLower = search.trim().toLowerCase();
  const elementFilterActive = filters.elements.length < RANKING_ELEMENTS.length;
  const categoryFilterActive = filters.dmgCategories.length < RANKING_DMG_CATEGORIES.length;

  // Filter before Best Only dedupe.
  let candidates = entries.filter(entry => {
    for (let i = 0; i < 3; i++) {
      const slotChar = entry.characters[i];
      // Sequence filters skip 4-stars.
      const rarity = slotChar ? DataLoader.characterDB[slotChar]?.rarity : undefined;
      if (rarity === 4) continue;
      const seq = entry.sequences[i] ?? 0;
      const range = filters.sequenceRanges[i];
      if (seq < range.min || seq > range.max) return false;
    }
    if (filters.rotationStyle !== 'any' && entry.rotationType !== filters.rotationStyle) return false;
    if (searchLower) {
      const label = entry.characters.filter(Boolean).join(' · ').toLowerCase();
      if (!label.includes(searchLower)) return false;
    }
    const { element, category } = entry.majority;
    if (elementFilterActive && (!element || !filters.elements.includes(element as RankingElement))) return false;
    if (categoryFilterActive && (!category || !filters.dmgCategories.includes(category as RankingDmgCategory))) return false;
    return true;
  });

  if (filters.bestOnly) {
    const bestByGroup = new Map<string, RankingEntry>();
    for (const entry of candidates) {
      const key = rotationGroupKey(entry);
      const existing = bestByGroup.get(key);
      const dps = entry.dpsStats[dpsFieldOf(activeWindow)] ?? 0;
      const existingDps = existing ? existing.dpsStats[dpsFieldOf(activeWindow)] ?? 0 : -Infinity;
      if (!existing || dps > existingDps) bestByGroup.set(key, entry);
    }
    candidates = Array.from(bestByGroup.values());
  }

  return candidates
    .slice()
    .sort((a, b) => (b.dpsStats[dpsFieldOf(activeWindow)] ?? 0) - (a.dpsStats[dpsFieldOf(activeWindow)] ?? 0));
}

interface RankingsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  entries: RankingEntry[];
  error: string | null;
  // No-op if already loading or ready.
  load: () => Promise<void>;

  // Persisted.
  activeWindow: DpsWindowKey;
  search: string;
  filters: RankingFilters;
  setActiveWindow: (window: DpsWindowKey) => void;
  setSearch: (search: string) => void;
  setFilters: (filters: RankingFilters) => void;

  // Persisted; reset to 1 on filter changes.
  page: number;
  pageSize: number;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;

  // True once rehydrated.
  hasHydrated: boolean;
}

// Rankings entries plus persisted filter/paging state.
export const useRankingsStore = create<RankingsState>()(
  persist(
    (set, get) => ({
  status: 'idle',
  entries: [],
  error: null,
  activeWindow: 'twoMin',
  search: '',
  filters: DEFAULT_RANKING_FILTERS,
  setActiveWindow: (activeWindow) => set({ activeWindow }),
  setSearch: (search) => set({ search }),
  setFilters: (filters) => set({ filters }),

  page: 1,
  pageSize: 10,
  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize, page: 1 }),

  hasHydrated: false,

  load: async () => {
    // Reload if result files changed.
    if (await checkResultsFreshness()) set({ status: 'idle', entries: [] });

    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading', error: null, entries: [] });

    try {
      const index = await DataLoader.loadRankingIndex();
      const entries: RankingEntry[] = index;
      set({ entries });
      set({ status: 'ready' });
    } catch (err: any) {
      set({ status: 'error', error: err?.message || String(err) });
    }
  }
    }),
    {
      name: 'wuwa_rankings_ui_cache',
      storage: persistStorage(),
      partialize: (state) => ({
        activeWindow: state.activeWindow,
        search: state.search,
        filters: state.filters,
        page: state.page,
        pageSize: state.pageSize
      }),
      // Deep-merge filters so missing fields get defaults.
      merge: (persistedState, currentState) => {
        const persisted = (persistedState || {}) as Partial<RankingsState>;
        return {
          ...currentState,
          ...persisted,
          filters: { ...currentState.filters, ...(persisted.filters || {}) }
        };
      },
      // Deferred until the store exists.
      onRehydrateStorage: () => () => {
        queueMicrotask(() => useRankingsStore.setState({ hasHydrated: true }));
      }
    }
  )
);
