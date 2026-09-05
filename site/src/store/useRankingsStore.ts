// src/store/useRankingsStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DataLoader } from '../utils/DataLoader';
import { checkResultsFreshness } from '../utils/dataFreshness';
import { postToWorker } from '../workers/calcWorkerClient';
import { ENEMY_DEFAULTS } from '../data/db';
import type { TeamSlot } from '../types/index';
import type { RotationResults } from '../types/results';
import type { DpsWindowKey } from '../types/results';
import { DEFAULT_RANKING_FILTERS, RANKING_ELEMENTS, RANKING_DMG_CATEGORIES } from '../components/rankings/RankingFilterToolbar';
import type { RankingFilters, RankingElement, RankingDmgCategory } from '../components/rankings/RankingFilterToolbar';

export interface RankingEntry {
  id: string;
  team: TeamSlot[];
  // [main DPS, sub DPS, support] sequence, i.e. team[0..2].sequence -- 0 when a slot is empty.
  sequences: number[];
  rotationType: 'linear' | 'quickswap' | null;
  dpsStats: RotationResults['dpsStats'];
  contribution: RotationResults['contribution'];
}

export const RANKING_DPS_FIELD: Record<DpsWindowKey, 'openerDps' | 'firstLoopDps' | 'avgLoopDps' | 'twoMinDps'> = {
  opener: 'openerDps',
  firstLoop: 'firstLoopDps',
  avgLoop: 'avgLoopDps',
  twoMin: 'twoMinDps'
};

// "Same rotation" for the Best Only toggle: same characters in the same slots at the same
// sequence. Gear/echoes and button order deliberately don't factor in -- two submissions that
// differ only there collapse into one entry, keeping the higher-DPS one.
function rotationGroupKey(entry: RankingEntry): string {
  return entry.team.map((slot, i) => `${slot.character || ''}@S${entry.sequences[i] ?? 0}`).join('|');
}

// Which single element / which single Basic-Heavy-Skill-Liberation-Echo category this entry's
// team dealt the most damage as, for the given window -- the DMG Type filter's basis. Element is
// attributed wholesale to each unit's own assigned element (DataLoader.characterDB[name].
// element), weighted by that unit's own total contribution for the window -- so e.g. a Fusion
// main DPS + Aero sub DPS reads as a "Fusion team", not a 50/50 split. Category is instead
// summed from each unit's own per-castType breakdown (contribution.units), since a single
// character's own hits already mix several categories together (a Basic-Attack-heavy kit still
// throws out Skill/Liberation hits too). Either can come back null if the team dealt no damage
// at all, or none of it falls into a tracked element/category.
function majorityDmgTypes(entry: RankingEntry, window: DpsWindowKey): { element: string | null; category: RankingDmgCategory | null } {
  const c = entry.contribution[window];
  const teamNames = new Set(entry.team.map(s => s.character).filter(Boolean));

  const elementTotals: Record<string, number> = {};
  c.team.forEach(slice => {
    if (!teamNames.has(slice.label)) return; // a status-effect tick's own label, not a team member
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

/** Applies the Rankings page's sequence/style/search filters, then (last) the Best Only dedupe
 * and DPS-descending sort -- shared by the full Rankings page and the Pin Comparison picker so
 * both apply identical rules to the exact same underlying entries. */
export function filterRankingEntries(
  entries: RankingEntry[],
  filters: RankingFilters,
  search: string,
  activeWindow: DpsWindowKey
): RankingEntry[] {
  const searchLower = search.trim().toLowerCase();
  // Faceted-checkbox convention (see RankingFilterToolbar's DEFAULT_RANKING_FILTERS): every box
  // checked means the facet is inactive (don't even bother computing majorityDmgTypes for every
  // entry when nothing's been narrowed), not "only pass entries matching all 6/5".
  const elementFilterActive = filters.elements.length < RANKING_ELEMENTS.length;
  const categoryFilterActive = filters.dmgCategories.length < RANKING_DMG_CATEGORIES.length;

  // Sequence range, rotation style, search text, and DMG Type narrow the candidate set first --
  // "Best Only" (below) only ever dedupes *within* whatever survives these, so a rotation
  // that's the best of its group never gets silently hidden by a duplicate that itself
  // would've been filtered out anyway.
  let candidates = entries.filter(entry => {
    for (let i = 0; i < 3; i++) {
      const slotChar = entry.team[i]?.character;
      // 4-star units are effectively always S6 -- dupes are far easier to acquire than even
      // S0 of a 5-star, so a sequence range that's meaningful for 5-stars doesn't apply here.
      const rarity = slotChar ? DataLoader.characterDB[slotChar]?.rarity : undefined;
      if (rarity === 4) continue;
      const seq = entry.sequences[i] ?? 0;
      const range = filters.sequenceRanges[i];
      if (seq < range.min || seq > range.max) return false;
    }
    if (filters.rotationStyle !== 'any' && entry.rotationType !== filters.rotationStyle) return false;
    if (searchLower) {
      const label = entry.team.filter(s => s.character).map(s => s.character).join(' · ').toLowerCase();
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
      const dps = entry.dpsStats[RANKING_DPS_FIELD[activeWindow]] ?? 0;
      const existingDps = existing ? existing.dpsStats[RANKING_DPS_FIELD[activeWindow]] ?? 0 : -Infinity;
      if (!existing || dps > existingDps) bestByGroup.set(key, entry);
    }
    candidates = Array.from(bestByGroup.values());
  }

  return candidates
    .slice()
    .sort((a, b) => (b.dpsStats[RANKING_DPS_FIELD[activeWindow]] ?? 0) - (a.dpsStats[RANKING_DPS_FIELD[activeWindow]] ?? 0));
}

interface RankingsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  entries: RankingEntry[];
  error: string | null;
  // No-op if already loading/ready -- safe to call from every mount of the Rankings page.
  load: () => Promise<void>;

  // Search/filter UI state -- persisted (see partialize below) so leaving the Rankings page
  // and coming back (or reloading) doesn't reset a filter setup you were mid-comparison with.
  // `entries`/`status`/`error` deliberately aren't persisted here, same reasoning as before:
  // they're cheap to recompute and could go stale if the underlying result files change.
  activeWindow: DpsWindowKey;
  search: string;
  filters: RankingFilters;
  setActiveWindow: (window: DpsWindowKey) => void;
  setSearch: (search: string) => void;
  setFilters: (filters: RankingFilters) => void;

  // Pagination -- both persisted (see partialize below), so a reload lands back on the same
  // page. RotationRankingsPage still resets page to 1 whenever search/filters/activeWindow
  // change, so switching *those* never leaves you stranded deep in a now-different result set --
  // this is purely about a plain reload/revisit preserving where you were.
  page: number;
  pageSize: number;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;

  // True once zustand's persist middleware has finished restoring localStorage into this store.
  // Rehydration is asynchronous and swaps in new (if deeply-equal) object references for
  // search/filters/activeWindow *after* the first render -- RotationRankingsPage's
  // reset-page-on-filter-change effect needs this to tell "rehydration just landed, ignore it"
  // apart from "the user actually changed something", or it would stomp a restored page number
  // straight back to 1 on every load.
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
  // Changing how many rows fit a page shifts what "page 2" even means -- reset to page 1 rather
  // than risk landing on a now-out-of-range or just-plain-different slice of entries.
  setPageSize: (pageSize) => set({ pageSize, page: 1 }),

  hasHydrated: false,

  load: async () => {
    // Silently evicts any character_results file that changed on the server since it was last
    // loaded -- if that touched anything already 'ready', force a real reload instead of
    // returning the now-stale entries list below.
    if (await checkResultsFreshness()) set({ status: 'idle', entries: [] });

    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading', error: null, entries: [] });

    try {
      const filenames = await DataLoader.loadCharacterResults();

      // Sequential on purpose -- postToWorker already serializes through one shared queue
      // (see calcWorkerClient.ts), and awaiting each entry here lets rows stream into the
      // list as they finish instead of the whole leaderboard popping in at once.
      for (const filename of filenames) {
        const data = DataLoader.characterResults[filename];
        if (!data) continue;

        try {
          // Omit<..., 'dmgOverTimeSeries'> -- a saved-results file's results never carry it
          // (see DataLoader.CharacterResultData), and this store never reads it either way.
          let results: Omit<RotationResults, 'dmgOverTimeSeries'>;
          if (data.results) {
            // Already computed (History's "Save Results" wrote this file) -- skip the worker
            // entirely instead of re-running the simulation for a known answer.
            results = data.results;
          } else {
            const options = data.settings || {};
            // Top-level payload keys, not left nested in `options` -- that's where calc.worker.ts
            // actually reads them from. Without this, any saved rotation with an Ending Rotation
            // split would silently compute its DPS/2-Minute stats as if the split didn't exist
            // (a plain truncated-loop tail instead of the authored replacement content).
            const endingRotationEnabled = data.settings?.endingRotationEnabled;
            const endRotationStartsEarlier = data.settings?.endRotationStartsEarlier;
            // 'recalculate' runs TimelineEngine.recalculateState + findLoopStart -- its
            // loopStartIndex is a required input to 'calculateDamage' below (mirrors the
            // two-step round trip useRotationStore's own Calculate button makes).
            const { result: recalcResult } = postToWorker('recalculate', {
              rows: data.rotation,
              team: data.team,
              options,
              enemy: ENEMY_DEFAULTS,
              endingRotationEnabled,
              endRotationStartsEarlier
            });
            const { loopStartIndex } = await recalcResult;

            const { result: calcResult } = postToWorker('calculateDamage', {
              rows: data.rotation,
              team: data.team,
              options,
              enemy: ENEMY_DEFAULTS,
              loopStartIndex,
              endingRotationEnabled,
              endRotationStartsEarlier
            });
            ({ results } = (await calcResult) as { results: RotationResults });
          }

          const entry: RankingEntry = {
            id: filename,
            team: data.team,
            sequences: [0, 1, 2].map(i => Number(data.team[i]?.sequence) || 0),
            rotationType: data.rotationType,
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
      partialize: (state) => ({
        activeWindow: state.activeWindow,
        search: state.search,
        filters: state.filters,
        page: state.page,
        pageSize: state.pageSize
      }),
      // zustand's default merge is `{...currentState, ...persistedState}` -- a shallow merge at
      // the TOP level only, so a persisted `filters` object (from before the DMG Type filter
      // existed) would replace the in-code default `filters` *wholesale*, leaving
      // elements/dmgCategories `undefined` and crashing the first render (`.length`/`.includes`
      // on undefined) instead of quietly defaulting to "all checked, no filtering" like a fresh
      // install gets. Deep-merging `filters` specifically -- defaults first, persisted values
      // overlaid on top -- means any field older localStorage doesn't have just falls back to
      // its default instead of vanishing.
      merge: (persistedState, currentState) => {
        const persisted = (persistedState || {}) as Partial<RankingsState>;
        return {
          ...currentState,
          ...persisted,
          filters: { ...currentState.filters, ...(persisted.filters || {}) }
        };
      },
      onRehydrateStorage: () => () => {
        useRankingsStore.setState({ hasHydrated: true });
      }
    }
  )
);
