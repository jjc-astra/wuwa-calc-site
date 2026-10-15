import React, { useRef } from 'react';
import { useAccordionAnimDone } from '../../hooks/useAccordionAnimDone';
import { useCollapseMaxHeight } from '../../hooks/useCollapseMaxHeight';

interface CollapsibleSectionProps {
  isOpen: boolean;
  onToggle: () => void;
  title: string;
  ids: { wrapper: string; header: string; content: string };
  /** Beside the title. */
  headerExtra?: React.ReactNode;
  headerRight?: React.ReactNode;
  /** Outside the collapsing content, so dialogs stay reachable. */
  overlays?: React.ReactNode;
  children: React.ReactNode;
}

/** A collapsible calculator step. */
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  isOpen, onToggle, title, ids, headerExtra, headerRight, overlays, children
}) => {
  const isCollapsed = !isOpen;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const animDone = useAccordionAnimDone(isOpen, wrapperRef);
  const maxHeight = useCollapseMaxHeight(isOpen, contentRef);

  // Header controls don't toggle.
  const handleHeaderClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('toggle-icon') || (target.tagName !== 'BUTTON' && target.tagName !== 'INPUT')) onToggle();
  };

  return (
    <div ref={wrapperRef} className={`section-wrapper ${isCollapsed ? 'is-collapsed' : ''} ${animDone ? 'anim-done' : ''}`} id={ids.wrapper}>
      <div className="section-header" id={ids.header} onClick={handleHeaderClick}>
        <div className="header-left">
          <button className={`toggle-icon ${isCollapsed ? 'collapsed' : ''}`}>▼</button>
          <h2 className="section-title">{title}</h2>
          {headerExtra}
        </div>
        <div className="header-right">{headerRight}</div>
      </div>
      <div id={ids.content} ref={contentRef} className="collapsible-content" style={{ maxHeight }} aria-hidden={isCollapsed}>
        {children}
      </div>
      {overlays}
    </div>
  );
};
