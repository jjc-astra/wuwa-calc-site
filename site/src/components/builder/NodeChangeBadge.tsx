// Warning badge on a mechanic's summary row when it differs from its saved (pristine) copy.
// Clicking opens a small menu with a per-row revert.
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useBuilderStore, nodeChangeKind } from '../../store/useBuilderStore';
import type { NodeChangeKind } from '../../store/useBuilderStore';
import { MechanicKey } from '../../utils/MechanicKey';
import { TooltipManager } from '../../utils/Common';
import { tip } from './mechanicNodeHelpers';

interface NodeChangeBadgeProps {
  nodeId: string;
}

export const NodeChangeBadge: React.FC<NodeChangeBadgeProps> = ({ nodeId }) => {
  const kind = useBuilderStore(s => nodeChangeKind(nodeId, s.mechanics[nodeId], s.renamedFrom));
  const origin = useBuilderStore(s => s.renamedFrom[nodeId]);
  const revertMechanicNode = useBuilderStore(s => s.revertMechanicNode);

  const [isOpen, setIsOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popupRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const close = (e: Event) => {
      if (e.target instanceof Node && popupRef.current?.contains(e.target)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!kind) setIsOpen(false);
  }, [kind]);

  if (!kind) return null;

  const descriptions: Record<NodeChangeKind, string> = {
    modified: 'Modified from saved data',
    renamed: `Renamed from "${origin ? MechanicKey.parse(origin).name : ''}"`,
    new: 'New mechanic (not in saved data)'
  };
  const actionLabel = kind === 'new' ? 'Discard this mechanic' : 'Revert to saved';

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    TooltipManager.hide();
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPos({ position: 'fixed', top: rect.bottom + 2, left: rect.left, ['--dropdown-accent' as string]: 'var(--danger)' });
    setIsOpen(o => !o);
  };

  const revert = () => {
    setIsOpen(false);
    if (!revertMechanicNode(nodeId)) {
      alert(`Can't revert: another mechanic already uses the original name "${origin ? MechanicKey.parse(origin).name : ''}". Rename or remove it first.`);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="mech-changed-badge"
        onClick={toggle}
        {...tip(`${descriptions[kind]} -- click for options`)}
      >
        <svg viewBox="0 0 24 24">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </button>
      {isOpen && createPortal(
        // Portaled, but React events still bubble through the tree to the summary cell's onClick.
        <div ref={popupRef} className="dropdown-popup" style={pos} onClick={e => e.stopPropagation()}>
          <div className="dropdown-option mech-revert-option" onMouseDown={e => e.preventDefault()} onClick={revert}>
            <span className="dropdown-option-label">{actionLabel}</span>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
