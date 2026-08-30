// src/store/useRankingsStore.ts
import { create } from 'zustand';
import { DataLoader } from '../utils/DataLoader';
import { postToWorker } from '../workers/calcWorkerClient';
import { ENEMY_DEFAULTS } from '../data/db';
import type { TeamSlot } from '../types/index';
import type { RotationResults } from '../types/results';

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
}

export const useRankingsStore = create<RankingsState>((set, get) => ({
  status: 'idle',
  entries: [],
  error: null,

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
          const options = data.settings || {};
          // 'recalculate' runs TimelineEngine.recalculateState + findLoopStart -- its
          // loopStartIndex is a required input to 'calculateDamage' below (mirrors the two-step
          // round trip useRotationStore's own Calculate button makes).
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
          const { results } = (await calcResult) as { results: RotationResults };

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
}));
