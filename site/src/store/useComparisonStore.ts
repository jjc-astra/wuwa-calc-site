import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '../utils/safeLocalStorage';
import { runFullCalculation } from '../workers/runFullCalculation';
import { DataLoader } from '../utils/DataLoader';
import type { DpsStats, DmgOverTimeSeries, DpsWindowKey, RotationResults, CalcInput } from '../types/results';
import { defaultEnemyStats } from '../data/db';
import { teamCharacters } from '../utils/TeamUtils';

export interface PinnedRotation {
  label: string;
  dpsStats: DpsStats;
  dmgOverTimeSeries: Record<DpsWindowKey, DmgOverTimeSeries>;
}

interface ComparisonState {
  pinned: PinnedRotation | null;
  status: 'idle' | 'loading';
  pinFromFile: (file: File) => Promise<void>;
  // Instant; no recalculation.
  pinFromHistoryEntry: (team: Array<{ character?: string }>, results: Pick<RotationResults, 'dpsStats' | 'dmgOverTimeSeries'>) => void;
  // Recalculates the ranked run.
  pinFromRankingEntry: (entry: { id: string; rotationFile: string }) => Promise<void>;
  unpin: () => void;
}

// Character names only, to fit the chip.
function labelFromTeam(team: Array<{ character?: string }> | undefined): string {
  if (!team) return 'Imported Rotation';
  const names = teamCharacters(team);
  return names.length > 0 ? names.join(' / ') : 'Imported Rotation';
}

export const useComparisonStore = create<ComparisonState>()(
  persist(
    (set) => {
      const recalcAndPin = async (label: string, input: CalcInput) => {
        set({ status: 'loading' });
        try {
          const { results } = await runFullCalculation(input);

          set({
            pinned: { label, dpsStats: results.dpsStats, dmgOverTimeSeries: results.dmgOverTimeSeries },
            status: 'idle'
          });
        } catch (err: any) {
          set({ status: 'idle' });
          alert(`Error calculating comparison: ${err?.message || err}`);
        }
      };

      return {
        pinned: null,
        status: 'idle',

        // Always recalculates.
        pinFromFile: async (file: File) => {
          const text = await file.text();
          let parsed: any;
          try {
            parsed = JSON.parse(text);
          } catch {
            alert('Error loading comparison: file is not valid JSON.');
            return;
          }

          const rotation = Array.isArray(parsed) ? parsed : parsed.rotation;
          const team = parsed.team;
          if (!Array.isArray(rotation) || !Array.isArray(team)) {
            alert('Error loading comparison: file is missing a rotation/team.');
            return;
          }

          let label = file.name.replace(/\.json$/i, '');
          const teamLabel = labelFromTeam(team);
          if (teamLabel !== 'Imported Rotation') label = teamLabel;

          await recalcAndPin(label, { rotation, team, settings: parsed.settings || {}, enemy: parsed.enemy ?? defaultEnemyStats() });
        },

        pinFromHistoryEntry: (team, results) => {
          set({ pinned: { label: labelFromTeam(team), dpsStats: results.dpsStats, dmgOverTimeSeries: results.dmgOverTimeSeries } });
        },

        pinFromRankingEntry: async (entry) => {
          let run;
          try {
            run = await DataLoader.loadRankedRun(entry);
          } catch {
            alert('Error loading comparison: this rotation is no longer available.');
            return;
          }
          await recalcAndPin(labelFromTeam(run.team), run);
        },

        unpin: () => set({ pinned: null })
      };
    },
    {
      name: 'wuwa_calc_pinned_comparison',
      storage: persistStorage(),
      partialize: (state) => ({ pinned: state.pinned })
    }
  )
);
