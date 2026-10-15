import React from 'react';

interface RouteLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'> {
  href: string;
  onNavigate: () => void;
}

/** Real <a href>; a plain click calls onNavigate instead. */
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
