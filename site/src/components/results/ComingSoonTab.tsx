// src/components/results/ComingSoonTab.tsx
import React from 'react';

interface ComingSoonTabProps {
  title: string;
  description: string;
}

export const ComingSoonTab: React.FC<ComingSoonTabProps> = ({ title, description }) => (
  <div className="results-coming-soon">
    <span className="coming-soon-badge">Coming Soon</span>
    <h3>{title}</h3>
    <p className="text-dim">{description}</p>
  </div>
);
