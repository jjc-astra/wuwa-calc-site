import React, { useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { useBuilderStore } from '../store/useBuilderStore';
import { NAV_ITEMS } from '../config/nav';
import type { ViewId } from '../config/nav';
import { HomeIcon, InfoIcon, HeartIcon, DiscordIcon, PatreonIcon, MenuIcon, CloseIcon } from './common/icons';
import type { IconProps } from './common/icons';
import { ActionsMenuButton } from './common/ActionsMenuButton';
import { SITE_FEATURES, SITE_LINKS } from '../data/db';
import { guidePath, viewPath } from '../config/routes';
import { goTo } from '../hooks/useRoute';
import { RouteLink } from './common/RouteLink';

// The Support menu's entries; one whose SITE_LINKS url is blank is left out.
const supportLinks = [
  {
    key: 'patreon',
    url: SITE_LINKS.PATREON_URL,
    label: (
      <span className="flex-row gap-sm brand-patreon">
        <PatreonIcon size={16} />
        <span>Patreon</span>
      </span>
    )
  },
  {
    key: 'kofi',
    url: SITE_LINKS.KOFI_URL,
    label: (
      <span className="flex-row gap-sm brand-kofi">
        <img src="/ko-fi-logotype-27349.svg" width={16} height={16} alt="" />
        <span>Ko-fi</span>
      </span>
    )
  }
].filter(link => link.url.trim() !== '');

interface HeaderProps {
  currentView: ViewId;
  onNavClick: (view: ViewId) => void;
  // The character the guide is open on, if any.
  guideCharacter?: string;
}

/** The site nav bar: home, page links, and the current page's Back to Library. Once the page links don't fit on the brand's row, they fold into a menu button. */
export const Header: React.FC<HeaderProps> = ({ currentView, onNavClick, guideCharacter }) => {
  const { activeChar, setActiveChar } = useBuilderStore();
  // The route the phone menu was opened on: navigating anywhere (back/forward included) closes it.
  const routeKey = `${currentView}/${guideCharacter ?? ''}`;
  const [menuOpenOn, setMenuOpenOn] = useState<string | null>(null);
  const menuOpen = menuOpenOn === routeKey;
  // Also closes it for a tap on the page already open, which changes no route.
  const navigateTo = (view: ViewId) => {
    setMenuOpenOn(null);
    onNavClick(view);
  };

  // Compact (menu button) whenever the full layout would push a page link off the brand's row.
  const headerRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const measure = () => {
      // Lays out the full header for the reading, then restores it -- all before paint, so no flicker.
      const restore = header.className;
      header.classList.remove('is-compact', 'is-menu-open');
      const rowMiddle = (el: Element) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
      const brandMiddle = rowMiddle(header.querySelector('.nav-brand')!);
      const links = header.querySelectorAll('.nav-items > :not(.nav-phone-only)');
      const wraps = [...links].some(link => Math.abs(rowMiddle(link) - brandMiddle) > 4);
      header.className = restore;
      setCompact(wraps);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
    // The right-hand group (Back to Library) changes with these, taking or freeing room on the row.
  }, [currentView, guideCharacter, activeChar]);

  const navLink = (id: ViewId, label: string, Icon: ComponentType<IconProps>, className = '') => (
    <RouteLink
      key={id}
      className={`nav-item-btn ${currentView === id ? 'is-active' : ''} ${className}`}
      href={viewPath(id)}
      onNavigate={() => navigateTo(id)}
    >
      <Icon size={15} />
      <span>{label}</span>
    </RouteLink>
  );

  return (
    <div ref={headerRef} className={`global-nav-header ${compact ? 'is-compact' : ''} ${compact && menuOpen ? 'is-menu-open' : ''}`}>
      <div className="header-left">
        <RouteLink className="nav-brand" href={viewPath('landing')} onNavigate={() => navigateTo('landing')}>
          <HomeIcon size={20} />
          <span>WuWa Calculator</span>
        </RouteLink>

        <nav className="nav-items" id="site-nav-items">
          {NAV_ITEMS.map(item => navLink(item.id, item.label, item.icon))}
          {navLink('about', 'About', InfoIcon, 'nav-phone-only')}
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

        {navLink('about', 'About', InfoIcon, 'nav-desktop-only')}

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

        {SITE_FEATURES.SHOW_SUPPORT_BUTTON && supportLinks.length > 0 && (
          <ActionsMenuButton
            triggerClassName="nav-item-btn text-gold"
            popupClassName="pin-menu-narrow"
            triggerContent={
              <>
                <HeartIcon size={15} />
                <span>Support</span>
              </>
            }
            items={supportLinks.map(({ key, url, label }) => ({
              key,
              label,
              onClick: () => window.open(url, '_blank', 'noopener,noreferrer')
            }))}
          />
        )}

        <button
          type="button"
          className="nav-item-btn nav-menu-btn"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="site-nav-items"
          onClick={() => setMenuOpenOn(menuOpen ? null : routeKey)}
        >
          {menuOpen ? <CloseIcon size={18} /> : <MenuIcon size={18} />}
        </button>
      </div>
    </div>
  );
};
