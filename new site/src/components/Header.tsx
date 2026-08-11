import React from 'react';
import { useBuilderStore } from '../store/useBuilderStore';
import { NAV_ITEMS } from '../config/nav';
import type { ViewId } from '../config/nav';
import { HomeIcon } from './common/icons';

interface HeaderProps {
  currentView: ViewId;
  onNavClick: (view: ViewId) => void;
}

export const Header: React.FC<HeaderProps> = ({ currentView, onNavClick }) => {
  const { activeChar, setActiveChar } = useBuilderStore();

  return (
    <div className="global-nav-header">
      <div className="header-left">
        <button className="nav-brand" onClick={() => onNavClick('landing')}>
          <HomeIcon size={20} />
          <span>WuWa Calculator</span>
        </button>

        <nav className="nav-items">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              className={`nav-item-btn ${currentView === item.id ? 'is-active' : ''}`}
              onClick={() => onNavClick(item.id)}
              title={item.comingSoon ? `${item.label} (Coming Soon)` : item.label}
            >
              <item.icon size={15} />
              <span>{item.label}</span>
              {item.comingSoon && <span className="coming-soon-badge">Soon</span>}
            </button>
          ))}
        </nav>
      </div>

      <div className="header-right">
        {currentView === 'builder' && activeChar !== null && (
          <button id="back-to-grid-btn" className="base-btn" onClick={() => setActiveChar(null)}>
            Back to Library
          </button>
        )}
      </div>
    </div>
  );
};
