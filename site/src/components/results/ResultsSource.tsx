// Where the Results panels read their data: the Calculator's stores by default, or whatever a
// wrapping provider supplies (the Character Guide).
import { createContext, useContext } from 'react';
import { useRotationStore } from '../../store/useRotationStore';
import { useRosterStore } from '../../store/useRosterStore';
import { useComparisonStore } from '../../store/useComparisonStore';
import type { PinnedRotation } from '../../store/useComparisonStore';
import type { PanelResults } from '../../types/results';
import type { TeamSlot } from '../../types';

export interface ResultsSource {
  results: PanelResults | null;
  team: TeamSlot[];
  isStale: boolean;
  pinned: PinnedRotation | null;
  // Shows the Pin Comparison control, which writes the Calculator's own pin.
  allowPin: boolean;
  // Set when the page owns the Team/Personal choice; Substat Worth then hides its own toggle.
  scope?: 'team' | 'personal';
}

export const ResultsSourceContext = createContext<ResultsSource | null>(null);

export function useResultsSource(): ResultsSource {
  const provided = useContext(ResultsSourceContext);
  const results = useRotationStore(s => s.results);
  const isStale = useRotationStore(s => s.isStale);
  const team = useRosterStore(s => s.team);
  const pinned = useComparisonStore(s => s.pinned);
  return provided ?? { results, team, isStale, pinned, allowPin: true };
}
