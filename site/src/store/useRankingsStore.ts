import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '../utils/safeLocalStorage';
import { DataLoader } from '../utils/DataLoader';
import { teamCharacters } from '../utils/TeamUtils';
import { checkResultsFreshness } from '../utils/dataFreshness';
import type { TeamSlot } from '../types/index';
import type { RotationResults } from '../types/results';
import type { DpsWindowKey } from '../types/results';
import { dpsFieldOf } from '../data/dpsWindows';
import { DEFAULT_RANKING_FILTERS, RANKING_ELEMENTS, RANKING_DMG_CATEGORIES } from '../components/rankings/RankingFilterToolbar';
import type { RankingFilters, RankingElement, RankingDmgCategory } from '../components/rankings/RankingFilterToolbar';

export interface RankingEntry {
  id: string;
  team: TeamSlot[];
  // [main DPS, sub DPS, support] sequence, i.e. team[0..2].sequence -- 0 when a slot is empty.
  sequences: number[];
  rotationType: 'linear' | 'quickswap' | null;
  author?: string;
  dpsStats: RotationResults['dpsStats'];
  contribution: RotationResults['contribution'];
}

const ROTATION_TYPE_LABELS = { linear: 'Linear', quickswap: 'Quickswap', unclassified: 'Unclassified' } as const;
export const rotationTypeLabel = (type: RankingEntry['rotationType']): string => ROTATION_TYPE_LABELS[type ?? 'unclassified'];

// "Same rotation" for Best Only: same characters, same slots, same sequence.
// Gear/echoes and button order don't factor in.
function rotationGroupKey(entry: RankingEntry): string {
  return entry.team.map((slot, i) => `${slot.character || ''}@S${entry.sequences[i] ?? 0}`).join('|');
}

// Element/category this team dealt the most damage as, for the DMG Type filter. Element is
// attributed per-unit by contribution (a Fusion main + Aero sub reads as "Fusion team");
// category sums each unit's per-castType breakdown, since one character mixes several.
function majorityDmgTypes(entry: RankingEntry, window: DpsWindowKey): { element: string | null; category: RankingDmgCategory | null } {
  const c = entry.contribution[window];
  const teamNames = new Set(teamCharacters(entry.team));

  const elementTotals: Record<string, number> = {};
  c.team.forEach(slice => {
    if (!teamNames.has(slice.label)) return; // a status-effect tick's label, not a team member
    const element = DataLoader.characterDB[slice.label]?.element;
    if (!element) return;
    elementTotals[element] = (elementTotals[element] || 0) + slice.dmg;
  });

  const categoryTotals: Record<string, number> = {};
  teamNames.forEach(unit => {
    (c.units[unit] || []).forEach(slice => {
      if (!(RANKING_DMG_CATEGORIES as readonly string[]).includes(slice.castType)) return;
      categoryTotals[slice.castType] = (categoryTotals[slice.castType] || 0) + slice.dmg;
    });
  });

  const pickMax = (totals: Record<string, number>): string | null => {
    let best: string | null = null;
    let bestDmg = 0;
    for (const [key, dmg] of Object.entries(totals)) {
      if (dmg > bestDmg) { best = key; bestDmg = dmg; }
    }
    return best;
  };

  return {
    element: pickMax(elementTotals),
    category: pickMax(categoryTotals) as RankingDmgCategory | null
  };
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
  // All boxes checked = facet inactive -- skip majorityDmgTypes per entry when nothing's narrowed.
  const elementFilterActive = filters.elements.length < RANKING_ELEMENTS.length;
  const categoryFilterActive = filters.dmgCategories.length < RANKING_DMG_CATEGORIES.length;

  // Sequence/style/search/DMG Type narrow candidates first; Best Only (below) only dedupes
  // within what survives, so a group's best isn't hidden by an already-filtered duplicate.
  let candidates = entries.filter(entry => {
    for (let i = 0; i < 3; i++) {
      const slotChar = entry.team[i]?.character;
      // 4-star units are effectively always S6, so a 5-star-meaningful sequence range doesn't apply.
      const rarity = slotChar ? DataLoader.characterDB[slotChar]?.rarity : undefined;
      if (rarity === 4) continue;
      const seq = entry.sequences[i] ?? 0;
      const range = filters.sequenceRanges[i];
      if (seq < range.min || seq > range.max) return false;
    }
    if (filters.rotationStyle !== 'any' && entry.rotationType !== filters.rotationStyle) return false;
    if (searchLower) {
      const label = teamCharacters(entry.team).join(' · ').toLowerCase();
      if (!label.includes(searchLower)) return false;
    }
    if (elementFilterActive || categoryFilterActive) {
      const { element, category } = majorityDmgTypes(entry, activeWindow);
      if (elementFilterActive && (!element || !filters.elements.includes(element as RankingElement))) return false;
      if (categoryFilterActive && (!category || !filters.dmgCategories.includes(category))) return false;
    }
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
      const filenames = await DataLoader.loadCharacterResults();

      for (const filename of filenames) {
        const data = DataLoader.characterResults[filename];
        if (!data) continue;

        // The leaderboard only trusts pre-computed results (from History's "Save Results") --
        // an entry exported without them isn't run through the worker just to populate a row.
        // (The Timeline drill-down is a separate, lighter recalculate-only pass -- see
        // useRotationTimelineData.ts -- that's fine to run live; this summary row is not.)
        if (!data.results) {
          console.warn(`[useRankingsStore] "${filename}" has no saved results -- skipping.`);
          continue;
        }

        try {
          const results = data.results;
          const entry: RankingEntry = {
            id: filename,
            team: data.team,
            sequences: [0, 1, 2].map(i => Number(data.team[i]?.sequence) || 0),
            rotationType: data.rotationType,
            author: data.author,
            dpsStats: results.dpsStats,
            contribution: results.contribution
          };
          set(state => ({ entries: [...state.entries, entry] }));
        } catch (err) {
          console.error(`[useRankingsStore] Failed to calculate "${filename}"`, err);
        }
      }

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
