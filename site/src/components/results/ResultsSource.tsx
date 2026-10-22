// Results panel data: the Calculator's stores, or a provider (Character Guide).
import { createContext, useContext } from 'react';
import { useRotationStore } from '../../store/useRotationStore';
import { useRosterStore } from '../../store/useRosterStore';
import { useComparisonStore } from '../../store/useComparisonStore';
import type { PinnedRotation } from '../../store/useComparisonStore';
import type { PanelResults } from '../../types/results';
import { teamCharacters } from '../../utils/TeamUtils';

export interface ResultsSource {
  results: PanelResults | null;
  // The units `results` belong to.
  units: string[];
  isStale: boolean;
  pinned: PinnedRotation | null;
  allowPin: boolean;
  allowSubstatToggle: boolean;
  // Page-owned Team/Personal choice.
  scope?: 'team' | 'personal';
}

export const ResultsSourceContext = createContext<ResultsSource | null>(null);

export function useResultsSource(): ResultsSource {
  const provided = useContext(ResultsSourceContext);
  const results = useRotationStore(s => s.results);
  const resultsUnits = useRotationStore(s => s.resultsUnits);
  const isStale = useRotationStore(s => s.isStale);
  const team = useRosterStore(s => s.team);
  const pinned = useComparisonStore(s => s.pinned);
  // Older saved results have no units: the roster.
  const units = results && resultsUnits ? resultsUnits : teamCharacters(team);
  return provided ?? { results, units, isStale, pinned, allowPin: true, allowSubstatToggle: true };
}
