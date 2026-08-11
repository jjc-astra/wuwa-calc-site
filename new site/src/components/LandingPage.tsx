// src/components/LandingPage.tsx
import React from 'react';
import { NAV_ITEMS } from '../config/nav';
import type { ViewId } from '../config/nav';

interface LandingPageProps {
  onNavigate: (view: ViewId) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onNavigate }) => {
  return (
    <div className="landing-page">
      <div className="landing-hero">
        <h1>
          <span className="accent">WuWa</span> Calculator
        </h1>
        <p>Tools for planning, building, and optimizing Wuthering Waves team rotations.</p>
      </div>

      <div className="landing-grid">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            className="landing-card"
            onClick={() => onNavigate(item.id)}
          >
            {item.comingSoon && <span className="coming-soon-badge">Coming Soon</span>}
            <span className="landing-card-icon">
              <item.icon size={24} />
            </span>
            <h3>{item.label}</h3>
            <p>{item.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
};
