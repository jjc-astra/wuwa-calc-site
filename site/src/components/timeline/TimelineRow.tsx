import React, { useLayoutEffect, useRef } from 'react';
import { CommonUtils, TooltipManager } from '../../utils/Common';
import { IMAGE_FOLDERS } from '../../data/db';
import { TimelineClip, buildClipTooltipHtml } from './TimelineClip';
import { ROW_HEIGHT_PX, CLIP_INSET_PX, simultaneousLineHeightPx, pxToCompressedTime } from './timelineLayout';
import { nearestMarker, trackPointer, useActiveMarker, useFrameMove } from './trackPointer';
import type { UnitRowData } from './timelineLayout';
import { useLinkedRowStore } from '../../store/useLinkedRowStore';
import { moveTarget, openInBuilder } from '../../utils/builderLinks';
import type { TrackPointer } from './trackPointer';

interface TimelineRowProps {
  data: UnitRowData;
  // Toggles the unit's effect rows.
  expander?: { open: boolean; count: number; onToggle: () => void };
  // Link hover with the rotation table.
  linked?: boolean;
}

/** One unit's row of clips and hit dots. */
export const TimelineRow: React.FC<TimelineRowProps> = ({ data, expander, linked = false }) => {
  const markActive = useActiveMarker();
  const trackRef = useRef<HTMLDivElement>(null);
  const hover = useLinkedRowStore(s => s.hover);

  // Linked-clip highlight, toggled on the DOM.
  useLayoutEffect(() => {
    const applyLinked = (rowIds: string[]) => {
      const ids = new Set(linked ? rowIds : []);
      trackRef.current?.querySelectorAll<HTMLElement>('.timeline-clip-hit').forEach(clip =>
        clip.classList.toggle('is-linked', !!clip.dataset.rowId && ids.has(clip.dataset.rowId)));
    };
    applyLinked(useLinkedRowStore.getState().rowIds);
    return useLinkedRowStore.subscribe((s, prev) => { if (s.rowIds !== prev.rowIds) applyLinked(s.rowIds); });
  });
  const hoverRow = (row: any) => { if (linked) hover(row?.id ? [row.id] : [], 'timeline'); };

  // Last segment under the cursor wins.
  const segmentAt = (pointer: TrackPointer) => {
    const inClipBand = pointer.y >= CLIP_INSET_PX && pointer.y <= ROW_HEIGHT_PX - CLIP_INSET_PX;
    return inClipBand ? [...data.segments].reverse().find(s => pointer.x >= s.xPx && pointer.x < s.xPx + s.widthPx) : undefined;
  };

  // Opens the move (snapped hit or clip) in the Mechanics Builder.
  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const pointer = trackPointer(e);
    const nearest = nearestMarker(data.hitDots, pointer);
    const target = moveTarget((nearest !== -1 ? data.hitDots[nearest].row : segmentAt(pointer)?.row)?.action);
    if (target) openInBuilder(target);
  };

  const move = useFrameMove(e => {
    const pointer = trackPointer(e);
    const nearest = nearestMarker(data.hitDots, pointer);
    if (nearest !== -1) {
      const dot = data.hitDots[nearest];
      const at = pointer.toClient(dot.xPx, dot.yPx);
      markActive(e.currentTarget.querySelector(`[data-dot="${nearest}"]`));
      hoverRow(dot.row);
      TooltipManager.showAtPoint(at.x, at.y, buildClipTooltipHtml({ type: 'onfield', row: dot.row }, dot.gameTime, dot.hitNumber, data.withSystemHits));
      return;
    }

    markActive(null);
    const segment = segmentAt(pointer);
    hoverRow(segment?.row);
    if (segment) TooltipManager.showAtPoint(e.clientX, e.clientY, buildClipTooltipHtml(segment, pxToCompressedTime(pointer.x, data.compression), undefined, data.withSystemHits));
    else TooltipManager.hide();
   });

  const handleLeave = () => {
    move.cancel();
    markActive(null);
    hoverRow(null);
    TooltipManager.hide();
  };

  const pill = (
    <div className="timeline-row-pill outline-badge">
      <img className="timeline-row-icon" src={CommonUtils.getIconPath(data.unit, IMAGE_FOLDERS.CHARACTERS)} alt={data.unit} />
      <span className="timeline-row-name">{data.unit}</span>
    </div>
  );

  return (
    <div
      className="timeline-row"
      style={{ height: ROW_HEIGHT_PX, ...data.themeVars } as React.CSSProperties}
    >
      <div className="timeline-row-header" style={{ width: 'var(--timeline-header-width)' }}>
        {expander ? (
          <button
            type="button"
            className={`timeline-expander ${expander.open ? 'is-open' : ''}`}
            onClick={expander.onToggle}
            disabled={expander.count === 0}
            aria-expanded={expander.open}
            aria-label={`${expander.open ? 'Hide' : 'Show'} ${data.unit}'s effects`}
          >
            <span className="timeline-expander-caret">▾</span>
            {pill}
            <span className="timeline-expander-count">{expander.count}</span>
          </button>
        ) : pill}
      </div>
      <div className="timeline-row-track" ref={trackRef} onMouseMove={move.onMove} onMouseLeave={handleLeave} onDoubleClick={handleDoubleClick}>
        {data.segments.map((segment, i) => (
          <TimelineClip key={i} segment={segment} />
        ))}
        {data.simultaneousLines.map((line, i) => (
          <div
            key={`sim-${i}`}
            className="timeline-simultaneous-line"
            style={{ left: line.xPx, width: line.widthPx, height: simultaneousLineHeightPx() }}
          />
        ))}
        {data.hitDots.map((dot, i) => (
          <div
            key={`hit-${i}`}
            className="timeline-hit-dot"
            data-dot={i}
            style={{ left: dot.xPx, top: dot.yPx }}
          />
        ))}
      </div>
    </div>
  );
};
