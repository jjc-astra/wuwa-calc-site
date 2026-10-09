import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '../utils/safeLocalStorage';
import { DataLoader } from '../utils/DataLoader';
import { checkResultsFreshness } from '../utils/dataFreshness';
import type { RankingIndexEntry, DpsWindowKey } from '../types/results';
import { dpsFieldOf } from '../data/dpsWindows';
import { DEFAULT_RANKING_FILTERS, RANKING_ELEMENTS, RANKING_DMG_CATEGORIES } from '../components/rankings/RankingFilterToolbar';
import type { RankingFilters, RankingElement, RankingDmgCategory } from '../components/rankings/RankingFilterToolbar';

// A ranked rotation as the index has it -- what search, filters and sort read. Rows load the rest
// (team details, author, contribution) from its results file (useRankedResults).
export type RankingEntry = RankingIndexEntry;

export const ROTATION_TYPE_LABELS = { linear: 'Linear', quickswap: 'Quickswap', unclassified: 'Unclassified' } as const;
export const rotationTypeLabel = (type: RankingEntry['rotationType']): string => ROTATION_TYPE_LABELS[type ?? 'unclassified'];

// "Same rotation" for Best Only: same characters, same slots, same sequence.
// Gear/echoes and button order don't factor in.
function rotationGroupKey(entry: RankingEntry): string {
  return entry.characters.map((character, i) => `${character}@S${entry.sequences[i] ?? 0}`).join('|');
}

/** Applies sequence/style/search filters, then Best Only dedupe and DPS-descending sort.
 * Shared by the Rankings page and Pin Comparison picker. */
export function filterRankingEntries(
  entries: RankingEntry[],
  filters: RankingFilters,
  search: string,
  activeWindow: DpsWindowKey
): RankingEntry[] {
  const searchLower = search.trim().toLowerCase();
  // All boxes checked = facet inactive.
  const elementFilterActive = filters.elements.length < RANKING_ELEMENTS.length;
  const categoryFilterActive = filters.dmgCategories.length < RANKING_DMG_CATEGORIES.length;

  // Sequence/style/search/DMG Type narrow candidates first; Best Only (below) only dedupes
  // within what survives, so a group's best isn't hidden by an already-filtered duplicate.
  let candidates = entries.filter(entry => {
    for (let i = 0; i < 3; i++) {
      const slotChar = entry.characters[i];
      // 4-star units are effectively always S6, so a 5-star-meaningful sequence range doesn't apply.
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
  // No-op if already loading/ready -- safe to call from every mount of the Rankings page.
  load: () => Promise<void>;

  // Persisted (see partialize below) so revisiting the page doesn't reset a filter setup.
  // `entries`/`status`/`error` aren't persisted -- cheap to recompute, could go stale otherwise.
  activeWindow: DpsWindowKey;
  search: string;
  filters: RankingFilters;
  setActiveWindow: (window: DpsWindowKey) => void;
  setSearch: (search: string) => void;
  setFilters: (filters: RankingFilters) => void;

  // Persisted so a reload lands on the same page. RotationRankingsPage still resets page to 1
  // when search/filters/activeWindow change.
  page: number;
  pageSize: number;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;

  // True once persist middleware finishes restoring localStorage. RotationRankingsPage's
  // reset-page-on-filter-change effect needs this to tell rehydration from a real user change.
  hasHydrated: boolean;
}

// Rankings entries, plus the page's persisted filter / paging state.
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
  pageSize: 20,
  setPage: (page) => set({ page }),
  // A page-size change shifts what "page 2" means, so reset to page 1.
  setPageSize: (pageSize) => set({ pageSize, page: 1 }),

  hasHydrated: false,

  load: async () => {
    // Evicts changed result files; force a real reload if that touched anything already 'ready'.
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
      // zustand's merge is shallow -- an old persisted `filters` (pre DMG-Type-filter) would
      // replace the default wholesale and crash on undefined .length/.includes. Deep-merge
      // filters so missing fields fall back.
      merge: (persistedState, currentState) => {
        const persisted = (persistedState || {}) as Partial<RankingsState>;
        return {
          ...currentState,
          ...persisted,
          filters: { ...currentState.filters, ...(persisted.filters || {}) }
        };
      },
      // Deferred: restoring from localStorage finishes while the store is still being created,
      // when `useRankingsStore` isn't assigned yet.
      onRehydrateStorage: () => () => {
        queueMicrotask(() => useRankingsStore.setState({ hasHydrated: true }));
      }
    }
  )
);
