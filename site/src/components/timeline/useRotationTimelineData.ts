import { useEffect, useRef, useState } from 'react';
import { DataLoader } from '../../utils/DataLoader';
import { postToWorker } from '../../workers/calcWorkerClient';
import { buildCalcRequest } from '../../workers/runFullCalculation';
import type { TeamSlot } from '../../types';

interface TimelineDataState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  evaluatedRows: any[];
  loopStartIndex: number | null;
  team: TeamSlot[];
  error: string | null;
}

const IDLE_STATE: TimelineDataState = { status: 'idle', evaluatedRows: [], loopStartIndex: null, team: [], error: null };

// Lazily recalculates a ranked entry's timeline rows via the worker (builder overrides included),
// leaving its saved ranking DPS untouched.
export function useRotationTimelineData(entry: { id: string; rotationFile: string } | null): TimelineDataState {
  const [state, setState] = useState<TimelineDataState>(IDLE_STATE);
  const requestIdRef = useRef(0);
  const entryId = entry?.id ?? null;

  useEffect(() => {
    if (!entry) {
      setState(IDLE_STATE);
      return;
    }

    const thisRequestId = ++requestIdRef.current;
    setState({ ...IDLE_STATE, status: 'loading' });

    (async () => {
      try {
        const run = await DataLoader.loadRankedRun(entry);
        // Hold Repeat blocks expanded, so each repeat draws as its own clip.
        const { result } = postToWorker('recalculate', await buildCalcRequest(run));
        const { evaluatedRows, loopStartIndex } = await result;
        if (requestIdRef.current !== thisRequestId) return; // collapsed/re-triggered since
        setState({ status: 'ready', evaluatedRows, loopStartIndex, team: run.team, error: null });
      } catch (err: any) {
        if (requestIdRef.current !== thisRequestId) return;
        setState({ ...IDLE_STATE, status: 'error', error: err?.message || String(err) });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  return state;
}
