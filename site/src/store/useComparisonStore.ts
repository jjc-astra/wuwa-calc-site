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
  // History entries already carry a full RotationResults (including dmgOverTimeSeries) from the
  // live Calculate press that produced them, so this pins instantly with no recalculation.
  pinFromHistoryEntry: (team: Array<{ character?: string }>, results: Pick<RotationResults, 'dpsStats' | 'dmgOverTimeSeries'>) => void;
  // A Rankings entry only ever carries dpsStats/contribution (see useRankingsStore.RankingEntry)
  // -- dmgOverTimeSeries is never kept around for it, so this re-runs the calc worker against the
  // manifest's raw rotation/team/settings, the same way pinFromFile does for an imported file.
  pinFromRankingEntry: (entryId: string) => Promise<void>;
  unpin: () => void;
}

// Character names only, no weapon initials -- unlike RotationBuilder's export filename (which
// has room to spare), this label sits in a fixed-width chip alongside the DPS/dmg-over-time
// charts, and 3 units' worth of "Name-WI" pairs runs out of room fast.
function labelFromTeam(team: Array<{ character?: string }> | undefined): string {
  if (!team) return 'Imported Rotation';
  const names = team.filter(s => s.character).map(s => s.character as string);
  return names.length > 0 ? names.join(' / ') : 'Imported Rotation';
}

export const useComparisonStore = create<ComparisonState>()(
  persist(
    (set) => {
      // Shared by pinFromFile and pinFromRankingEntry -- both end up needing the exact same
      // "run it through the real calc worker, keep dpsStats + dmgOverTimeSeries" round trip,
      // just sourced from a File vs. an already-loaded manifest entry.
      const recalcAndPin = async (label: string, rotation: any[], team: any[], options: any) => {
        set({ status: 'loading' });
        try {
          // Pulled out to top-level payload keys, not left nested in `options` -- that's where
          // calc.worker.ts actually reads them from. Without this, a pinned rotation with an
          // Ending Rotation split would silently compare against its plain truncated-loop tail.
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

        // A pinned file only ever carries rotation/team/settings (a plain Export Rotation) or
        // that plus a saved results object without dmgOverTimeSeries (History's "Save Results" --
        // see DataLoader.CharacterResultData) -- the dmg-over-time chart needs real per-hit points
        // either way, so this always re-runs the actual calc worker instead of trusting a
        // possibly-absent saved dpsStats.
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
