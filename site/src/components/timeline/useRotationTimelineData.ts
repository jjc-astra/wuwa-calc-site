// src/components/timeline/useRotationTimelineData.ts
import { useEffect, useRef, useState } from 'react';
import { DataLoader } from '../../utils/DataLoader';
import { postToWorker } from '../../workers/calcWorkerClient';
import { buildBuilderPayload } from '../../workers/builderOverridePayload';
import { ENEMY_DEFAULTS } from '../../data/db';
import type { TeamSlot } from '../../types';

interface TimelineDataState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  evaluatedRows: any[];
  loopStartIndex: number | null;
  team: TeamSlot[];
  error: string | null;
}

const IDLE_STATE: TimelineDataState = { status: 'idle', evaluatedRows: [], loopStartIndex: null, team: [], error: null };

// Lazily recalculates a saved Rankings result's rotation through the calc worker to get the
// evaluated rows (game-time-positioned moves) a Timeline needs -- only fires while `resultId`
// is non-null, so a collapsed row never pays for a worker round trip. Mirrors the
// postToWorker('recalculate', ...) call useRankingsStore.load()/useComparisonStore already make;
// only `evaluatedRows`/`loopStartIndex` are needed here (no 'calculateDamage' pass), since the
// Timeline never needs per-hit damage numbers. Unlike those two, this DOES attach
// buildBuilderPayload -- the Timeline is a visualization of a mechanic's timing as currently
// configured, so an in-progress edit in the Mechanics Builder (e.g. retuning an Outro's
// cancelTimings) should show up here immediately, the same way it already does in the live
// Rotation Calculator's own "Calculate" press. The Rankings leaderboard's own DPS number stays
// deliberately pristine (see useRotationStore.ts's buildBuilderPayload comment) -- only this
// Timeline view diverges from that.
export function useRotationTimelineData(resultId: string | null): TimelineDataState {
  const [state, setState] = useState<TimelineDataState>(IDLE_STATE);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!resultId) {
      setState(IDLE_STATE);
      return;
    }

    const thisRequestId = ++requestIdRef.current;
    setState({ ...IDLE_STATE, status: 'loading' });

    const data = DataLoader.characterResults[resultId];
    if (!data) {
      setState({ ...IDLE_STATE, status: 'error', error: 'This rotation is no longer available.' });
      return;
    }

    (async () => {
      try {
        const { result } = postToWorker('recalculate', {
          rows: data.rotation,
          team: data.team,
          options: data.settings || {},
          enemy: ENEMY_DEFAULTS,
          ...buildBuilderPayload(data.team)
        });
        const { evaluatedRows, loopStartIndex } = await result;
        if (requestIdRef.current !== thisRequestId) return; // collapsed/re-triggered since
        setState({ status: 'ready', evaluatedRows, loopStartIndex, team: data.team, error: null });
      } catch (err: any) {
        if (requestIdRef.current !== thisRequestId) return;
        setState({ ...IDLE_STATE, status: 'error', error: err?.message || String(err) });
      }
    })();
  }, [resultId]);

  return state;
}
