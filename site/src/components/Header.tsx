import React from 'react';
import { useBuilderStore } from '../store/useBuilderStore';
import { NAV_ITEMS } from '../config/nav';
import type { ViewId } from '../config/nav';
import { HomeIcon, HeartIcon, DiscordIcon, PatreonIcon } from './common/icons';
import { ActionsMenuButton } from './common/ActionsMenuButton';
import { SITE_FEATURES, SITE_LINKS } from '../data/db';
import { tip } from '../utils/Common';

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
              {...tip(item.comingSoon ? `${item.label} (Coming Soon)` : item.label)}
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

        {SITE_FEATURES.SHOW_DISCORD_BUTTON && (
          <a
            className="nav-item-btn brand-discord"
            href={SITE_LINKS.DISCORD_INVITE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <DiscordIcon size={15} />
            <span>Discord</span>
          </a>
        )}

        {SITE_FEATURES.SHOW_SUPPORT_BUTTON && (
          <ActionsMenuButton
            triggerClassName="nav-item-btn text-gold"
            popupClassName="pin-menu-narrow"
            triggerContent={
              <>
                <HeartIcon size={15} />
                <span>Support</span>
              </>
            }
            items={[
              {
                key: 'patreon',
                label: (
                  <span className="flex-row gap-sm brand-patreon">
                    <PatreonIcon size={16} />
                    <span>Patreon</span>
                  </span>
                ),
                onClick: () => window.open(SITE_LINKS.PATREON_URL, '_blank', 'noopener,noreferrer')
              },
              {
                key: 'kofi',
                label: (
                  <span className="flex-row gap-sm brand-kofi">
                    <img src="/ko-fi-logotype-27349.svg" width={16} height={16} alt="" />
                    <span>Ko-fi</span>
                  </span>
                ),
                onClick: () => window.open(SITE_LINKS.KOFI_URL, '_blank', 'noopener,noreferrer')
              }
            ]}
          />
        )}
      </div>
    </div>
  );
};
