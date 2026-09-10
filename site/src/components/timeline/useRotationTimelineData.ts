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

// Lazily recalculates a saved result via the calc worker for evaluatedRows/loopStartIndex --
// only fires while `resultId` is set, so a collapsed row costs nothing. Mirrors
// useRankingsStore.load()'s postToWorker('recalculate', ...) but skips 'calculateDamage'
// (Timeline needs no per-hit damage). Unlike those callers, this attaches buildBuilderPayload
// so in-progress Builder edits show immediately -- Rankings' own DPS stays deliberately
// pristine (useRotationStore.ts), only this Timeline view diverges.
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
          // Top-level payload keys, not nested in `options` -- that's where calc.worker.ts's
          // 'recalculate' handler reads them from. Without this, an Ending Rotation split would
          // silently start after just the one authored loop rep instead of the real skip-ahead.
          endingRotationEnabled: data.settings?.endingRotationEnabled,
          endRotationStartsEarlier: data.settings?.endRotationStartsEarlier,
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
