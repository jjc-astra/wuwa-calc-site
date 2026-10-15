import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { DataLoader } from '../../utils/DataLoader';
import type { ResultsFile, RosterSlot } from '../../types/results';
import type { RankingEntry } from '../../store/useRankingsStore';

/** A ranked rotation's results file; null until loaded. `inViewOf`: wait until in view. */
export function useRankedResults(entry: RankingEntry, inViewOf?: RefObject<Element | null>): ResultsFile | null {
  const [results, setResults] = useState<ResultsFile | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => DataLoader.loadRankedResults(entry).then(file => { if (alive) setResults(file); }).catch(() => {});
    const el = inViewOf?.current;
    if (!el) {
      load();
      return () => { alive = false; };
    }
    const observer = new IntersectionObserver(([seen]) => {
      if (!seen.isIntersecting) return;
      observer.disconnect();
      load();
    });
    observer.observe(el);
    return () => { alive = false; observer.disconnect(); };
  }, [entry, inViewOf]);

  return results;
}

/** The results file's team, or the index roster until it loads. */
export const rosterOf = (entry: RankingEntry, results: ResultsFile | null): RosterSlot[] =>
  results?.team ?? entry.characters.map((character, i) => ({
    character, sequence: entry.sequences[i] ?? 0, weapon: '', rank: 1,
    mainSet: '', subSet: '', subSet2a: '', subSet2b: '', mainEcho: '', layout: ''
  }));
