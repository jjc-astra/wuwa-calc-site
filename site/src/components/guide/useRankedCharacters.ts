import { useEffect, useMemo } from 'react';
import { useRankingsStore } from '../../store/useRankingsStore';

/** Loads the rankings index and the ranked characters. */
export function useRankedCharacters() {
  const { status, entries, error, load } = useRankingsStore();

  useEffect(() => {
    load();
  }, [load]);

  const rankedCharacters = useMemo(() => {
    const names = new Set<string>();
    entries.forEach(e => e.characters.forEach(character => { if (character) names.add(character); }));
    return names;
  }, [entries]);

  return { status, entries, error, rankedCharacters };
}
