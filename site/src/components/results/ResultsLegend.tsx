// src/components/results/ResultsLegend.tsx
import React from 'react';

interface ResultsLegendItem {
  label: string;
  color: string;
}

interface ResultsLegendProps {
  items: ResultsLegendItem[];
}

/** Shared swatch + label legend row used above any results chart with more than one series. */
export const ResultsLegend: React.FC<ResultsLegendProps> = ({ items }) => (
  <div className="results-legend">
    {items.map(item => (
      <span key={item.label} className="results-legend-item">
        <span className="results-legend-swatch" style={{ background: item.color }} />
        <span className="text-dim">{item.label}</span>
      </span>
    ))}
  </div>
);
