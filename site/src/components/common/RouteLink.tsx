import React from 'react';

interface RouteLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'> {
  href: string;
  onNavigate: () => void;
}

/** An in-app link: a real <a href> for crawlers and new-tab opens, but a plain click runs onNavigate instead of a page load. */
export const RouteLink: React.FC<RouteLinkProps> = ({ href, onNavigate, ...rest }) => (
  <a
    {...rest}
    href={href}
    onClick={e => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      onNavigate();
    }}
  />
);
