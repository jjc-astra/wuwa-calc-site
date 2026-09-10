import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { postToWorker } from '../workers/calcWorkerClient';
import { ENEMY_DEFAULTS } from '../data/db';
import { DataLoader } from '../utils/DataLoader';
import type { DpsStats, DmgOverTimeSeries, DpsWindowKey, RotationResults } from '../types/results';

export interface PinnedRotation {
  label: string;
  dpsStats: DpsStats;
  dmgOverTimeSeries: Record<DpsWindowKey, DmgOverTimeSeries>;
}

interface ComparisonState {
  pinned: PinnedRotation | null;
  status: 'idle' | 'loading';
  pinFromFile: (file: File) => Promise<void>;
  // History entries already carry dmgOverTimeSeries from the Calculate press that produced
  // them -- pins instantly, no recalculation.
  pinFromHistoryEntry: (team: Array<{ character?: string }>, results: Pick<RotationResults, 'dpsStats' | 'dmgOverTimeSeries'>) => void;
  // Rankings entries only carry dpsStats/contribution, never dmgOverTimeSeries -- re-runs the
  // calc worker against the manifest's rotation/team/settings, like pinFromFile does for a file.
  pinFromRankingEntry: (entryId: string) => Promise<void>;
  unpin: () => void;
}

// Character names only, no weapon initials -- unlike the export filename, this sits in a
// fixed-width chip and runs out of room fast with "Name-WI" pairs for 3 units.
function labelFromTeam(team: Array<{ character?: string }> | undefined): string {
  if (!team) return 'Imported Rotation';
  const names = team.filter(s => s.character).map(s => s.character as string);
  return names.length > 0 ? names.join(' / ') : 'Imported Rotation';
}

export const useComparisonStore = create<ComparisonState>()(
  persist(
    (set) => {
      // Shared by pinFromFile and pinFromRankingEntry -- same calc-worker round trip, just
      // sourced from a File vs. an already-loaded manifest entry.
      const recalcAndPin = async (label: string, rotation: any[], team: any[], options: any) => {
        set({ status: 'loading' });
        try {
          // Top-level, not nested in `options` -- calc.worker.ts reads them from there.
          // Otherwise an Ending Rotation split silently compares against its truncated tail.
          const endingRotationEnabled = options?.endingRotationEnabled;
          const endRotationStartsEarlier = options?.endRotationStartsEarlier;
          const { result: recalcResult } = postToWorker('recalculate', {
            rows: rotation, team, options, enemy: ENEMY_DEFAULTS, endingRotationEnabled, endRotationStartsEarlier
          });
          const { loopStartIndex } = await recalcResult;

          const { result: calcResult } = postToWorker('calculateDamage', {
            rows: rotation, team, options, enemy: ENEMY_DEFAULTS, loopStartIndex, endingRotationEnabled, endRotationStartsEarlier
          });
          const { results } = (await calcResult) as { results: RotationResults };

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

        // A pinned file carries rotation/team/settings, sometimes plus saved results without
        // dmgOverTimeSeries (History's "Save Results"). Either way the chart needs real per-hit
        // points, so this always re-runs the calc worker instead of trusting a saved dpsStats.
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

          await recalcAndPin(label, rotation, team, parsed.settings || {});
        },

        pinFromHistoryEntry: (team, results) => {
          set({ pinned: { label: labelFromTeam(team), dpsStats: results.dpsStats, dmgOverTimeSeries: results.dmgOverTimeSeries } });
        },

        pinFromRankingEntry: async (entryId: string) => {
          const data = DataLoader.characterResults[entryId];
          if (!data) {
            alert('Error loading comparison: this rotation is no longer available.');
            return;
          }
          await recalcAndPin(labelFromTeam(data.team), data.rotation, data.team, data.settings || {});
        },

        unpin: () => set({ pinned: null })
      };
    },
    {
      name: 'wuwa_calc_pinned_comparison',
      partialize: (state) => ({ pinned: state.pinned })
    }
  )
);
