// src/components/timeline/useRotationTimelineData.ts
import { useEffect, useRef, useState } from 'react';
import { DataLoader } from '../../utils/DataLoader';
import { postToWorker } from '../../workers/calcWorkerClient';
import { buildBuilderPayload } from '../../workers/builderOverridePayload';
import { expandRepeatBlocks } from '../../logic/RepeatBlocks';
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

// Lazily recalculates timeline rows via worker on resultId changes, injecting buildBuilderPayload for live edits while keeping saved ranking DPS untouched.
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
        // Expands Hold Repeat blocks into explicit row clones for timeline simulation, rendering each repeat as an individual clip.
        const { expanded } = expandRepeatBlocks(data.rotation);
        const { result } = postToWorker('recalculate', {
          rows: expanded,
          team: data.team,
          options: data.settings || {},
          enemy: ENEMY_DEFAULTS,
          // Sends keys at payload root for calc.worker.ts, ensuring Ending Rotation splits properly account for full loop iterations.
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
