import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CommonUtils, TooltipManager } from '../../utils/Common';
import { IMAGE_FOLDERS } from '../../data/db';
import { TimelineClip, buildClipTooltipHtml } from './TimelineClip';
import { ROW_HEIGHT_PX, CLIP_INSET_PX, simultaneousLineHeightPx } from './timelineLayout';
import { nearestMarker, trackPointer } from './trackPointer';
import type { UnitRowData } from './timelineLayout';
import { useLinkedRowStore, scrollIntoContainer } from '../../store/useLinkedRowStore';

interface TimelineRowProps {
  data: UnitRowData;
  // A caret beside the unit's pill that shows/hides the rows nested under it (its effects).
  expander?: { open: boolean; count: number; onToggle: () => void };
  // Linked to the rotation table (useLinkedRowStore): hovering a move highlights its table row,
  // and hovering a table row highlights (and scrolls to) its clips here.
  linked?: boolean;
}

/** One unit's row: icon, name, clips and hit dots. Hovering near a dot snaps the tooltip to that hit. */
export const TimelineRow: React.FC<TimelineRowProps> = ({ data, expander, linked = false }) => {
  const [activeDot, setActiveDot] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const hover = useLinkedRowStore(s => s.hover);
  const rowIds = useLinkedRowStore(s => s.rowIds);
  const linkedIds = useMemo(() => new Set(linked ? rowIds : []), [linked, rowIds]);
  const scrollId = useLinkedRowStore(s => (linked && s.source === 'table' ? s.rowIds[0] ?? null : null));
  const hoverRow = (row: any) => { if (linked) hover(row?.id ? [row.id] : [], 'timeline'); };

  // A table row hovered: bring its first clip into view.
  useEffect(() => {
    if (!scrollId) return;
    const clip = trackRef.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(scrollId)}"]`);
    // Past the sticky name column, not under it.
    const names = trackRef.current?.previousElementSibling?.getBoundingClientRect().width ?? 0;
    if (clip) scrollIntoContainer(clip, clip.closest<HTMLElement>('.timeline-scroll'), { insetLeft: names });
  }, [scrollId]);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const pointer = trackPointer(e);
    const nearest = nearestMarker(data.hitDots, pointer);
    if (nearest !== -1) {
      const dot = data.hitDots[nearest];
      const at = pointer.toClient(dot.xPx, dot.yPx);
      setActiveDot(nearest);
      hoverRow(dot.row);
      TooltipManager.showAtPoint(at.x, at.y, buildClipTooltipHtml({ type: 'onfield', row: dot.row }, dot.hitNumber, data.withSystemHits));
      return;
    }

    setActiveDot(null);
    // Later segments draw on top, so the last one under the cursor wins.
    const inClipBand = pointer.y >= CLIP_INSET_PX && pointer.y <= ROW_HEIGHT_PX - CLIP_INSET_PX;
    const segment = inClipBand ? [...data.segments].reverse().find(s => pointer.x >= s.xPx && pointer.x < s.xPx + s.widthPx) : undefined;
    hoverRow(segment?.row);
    if (segment) TooltipManager.showAtPoint(e.clientX, e.clientY, buildClipTooltipHtml(segment, undefined, data.withSystemHits));
    else TooltipManager.hide();
  };

  const handleLeave = () => {
    setActiveDot(null);
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
      style={{ height: ROW_HEIGHT_PX, '--char-theme-raw': data.themeColor } as React.CSSProperties}
    >
      <div className="timeline-row-header" style={{ width: 'var(--timeline-header-width)' }}>
        {expander ? (
          // The whole label opens/closes the unit's effects, like a section header.
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
      <div className="timeline-row-track" ref={trackRef} onMouseMove={handleMove} onMouseLeave={handleLeave}>
        {data.segments.map((segment, i) => (
          <TimelineClip key={i} segment={segment} isLinked={linkedIds.has(segment.row?.id)} />
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
            className={`timeline-hit-dot${i === activeDot ? ' is-active' : ''}`}
            style={{ left: dot.xPx, top: dot.yPx }}
          />
        ))}
      </div>
    </div>
  );
};
