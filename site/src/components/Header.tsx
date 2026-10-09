import React from 'react';
import { useBuilderStore } from '../store/useBuilderStore';
import { NAV_ITEMS } from '../config/nav';
import type { ViewId } from '../config/nav';
import { HomeIcon, InfoIcon, HeartIcon, DiscordIcon, PatreonIcon } from './common/icons';
import { ActionsMenuButton } from './common/ActionsMenuButton';
import { SITE_FEATURES, SITE_LINKS } from '../data/db';
import { guidePath, viewPath } from '../config/routes';
import { goTo } from '../hooks/useRoute';
import { RouteLink } from './common/RouteLink';

interface HeaderProps {
  currentView: ViewId;
  onNavClick: (view: ViewId) => void;
  // The character the guide is open on, if any.
  guideCharacter?: string;
}

/** The site nav bar: home, page links, and the current page's Back to Library. */
export const Header: React.FC<HeaderProps> = ({ currentView, onNavClick, guideCharacter }) => {
  const { activeChar, setActiveChar } = useBuilderStore();

  return (
    <div className="global-nav-header">
      <div className="header-left">
        <RouteLink className="nav-brand" href={viewPath('landing')} onNavigate={() => onNavClick('landing')}>
          <HomeIcon size={20} />
          <span>WuWa Calculator</span>
        </RouteLink>

        <nav className="nav-items">
          {NAV_ITEMS.map(item => (
            <RouteLink
              key={item.id}
              className={`nav-item-btn ${currentView === item.id ? 'is-active' : ''}`}
              href={viewPath(item.id)}
              onNavigate={() => onNavClick(item.id)}
            >
              <item.icon size={15} />
              <span>{item.label}</span>
            </RouteLink>
          ))}
        </nav>
      </div>

      <div className="header-right">
        {currentView === 'builder' && activeChar !== null && (
          <button id="back-to-grid-btn" className="base-btn" onClick={() => setActiveChar(null)}>
            Back to Library
          </button>
        )}
        {currentView === 'guide' && guideCharacter && (
          <button className="base-btn" onClick={() => goTo(guidePath())}>
            Back to Library
          </button>
        )}

        <RouteLink
          className={`nav-item-btn ${currentView === 'about' ? 'is-active' : ''}`}
          href={viewPath('about')}
          onNavigate={() => onNavClick('about')}
        >
          <InfoIcon size={15} />
          <span>About</span>
        </RouteLink>

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
