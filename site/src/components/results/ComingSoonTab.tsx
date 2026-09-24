import React from 'react';

interface ComingSoonTabProps {
  title: string;
  description: string;
}

/** Placeholder for a tab that isn't built yet. */
export const ComingSoonTab: React.FC<ComingSoonTabProps> = ({ title, description }) => (
  <div className="results-coming-soon">
    <span className="coming-soon-badge caps-tag pill-badge">Coming Soon</span>
    <h3>{title}</h3>
    <p className="text-dim">{description}</p>
  </div>
);
