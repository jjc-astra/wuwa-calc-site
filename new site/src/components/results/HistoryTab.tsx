// src/components/results/HistoryTab.tsx
import React from 'react';
import { useRotationHistoryStore } from '../../store/useRotationHistoryStore';
import { HistoryRow } from './HistoryRow';

export const HistoryTab: React.FC = () => {
  const entries = useRotationHistoryStore(s => s.entries);

  if (entries.length === 0) {
    return <div className="results-empty">Press Calculate to start building a history of your rotations.</div>;
  }

  return (
    <div className="history-list">
      {entries.map(entry => (
        <HistoryRow key={entry.id} entry={entry} />
      ))}
    </div>
  );
};
