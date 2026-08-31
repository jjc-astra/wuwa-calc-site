// src/store/useRankingsStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DataLoader } from '../utils/DataLoader';
import { postToWorker } from '../workers/calcWorkerClient';
import { ENEMY_DEFAULTS } from '../data/db';
import type { TeamSlot } from '../types/index';
import type { RotationResults } from '../types/results';
import type { DpsWindowKey } from '../types/results';
import { DEFAULT_RANKING_FILTERS } from '../components/rankings/RankingFilterToolbar';
import type { RankingFilters } from '../components/rankings/RankingFilterToolbar';

export interface RankingEntry {
  id: string;
  team: TeamSlot[];
  // [main DPS, sub DPS, support] sequence, i.e. team[0..2].sequence -- 0 when a slot is empty.
  sequences: number[];
  rotationType: 'linear' | 'quickswap' | null;
  dpsStats: RotationResults['dpsStats'];
  contribution: RotationResults['contribution'];
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

  load: async () => {
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
            // 'recalculate' runs TimelineEngine.recalculateState + findLoopStart -- its
            // loopStartIndex is a required input to 'calculateDamage' below (mirrors the
            // two-step round trip useRotationStore's own Calculate button makes).
            const { result: recalcResult } = postToWorker('recalculate', {
              rows: data.rotation,
              team: data.team,
              options,
              enemy: ENEMY_DEFAULTS
            });
            const { loopStartIndex } = await recalcResult;

            const { result: calcResult } = postToWorker('calculateDamage', {
              rows: data.rotation,
              team: data.team,
              options,
              enemy: ENEMY_DEFAULTS,
              loopStartIndex
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
        filters: state.filters
      })
    }
  )
);
