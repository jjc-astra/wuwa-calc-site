import React, { useRef } from 'react';
import { useAccordionAnimDone } from '../../hooks/useAccordionAnimDone';
import { useCollapseMaxHeight } from '../../hooks/useCollapseMaxHeight';

interface CollapsibleSectionProps {
  isOpen: boolean;
  onToggle: () => void;
  title: string;
  /** DOM ids for the three pieces, which scroll helpers and stylesheets address directly. */
  ids: { wrapper: string; header: string; content: string };
  /** Beside the title, in the header (e.g. a team preview that shows while collapsed). */
  headerExtra?: React.ReactNode;
  /** Right side of the header (Import / Export buttons). */
  headerRight?: React.ReactNode;
  /** Rendered inside the wrapper but outside the collapsing content, so a dialog stays reachable
   * (and un-aria-hidden) while the section is collapsed. */
  overlays?: React.ReactNode;
  children: React.ReactNode;
}

/** A calculator step: a header with a collapse arrow, over content that animates open and shut. */
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  isOpen, onToggle, title, ids, headerExtra, headerRight, overlays, children
}) => {
  const isCollapsed = !isOpen;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const animDone = useAccordionAnimDone(isOpen, wrapperRef);
  const maxHeight = useCollapseMaxHeight(isOpen, contentRef);

  // The arrow and the bare header toggle; any other button or input in the header (Import,
  // Export) is its own control.
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
