import React, { useState } from 'react';
import { CommonUtils, TooltipManager } from '../../utils/Common';
import { IMAGE_FOLDERS } from '../../data/db';
import { TimelineClip, buildClipTooltipHtml } from './TimelineClip';
import { HEADER_COL_WIDTH_PX, ROW_HEIGHT_PX, CLIP_INSET_PX, simultaneousLineHeightPx } from './timelineLayout';
import type { UnitRowData } from './timelineLayout';

interface TimelineRowProps {
  data: UnitRowData;
}

// How close (design px) the cursor must be to a hit dot to snap to it.
const HIT_SNAP_RADIUS_PX = 6;

/** One unit's row: icon, name, clips and hit dots. Hovering near a dot snaps the tooltip to that hit. */
export const TimelineRow: React.FC<TimelineRowProps> = ({ data }) => {
  const [activeDot, setActiveDot] = useState<number | null>(null);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    // The timeline is CSS-zoomed: client px -> the track's own design px.
    const track = e.currentTarget;
    const rect = track.getBoundingClientRect();
    const k = rect.width > 0 ? track.offsetWidth / rect.width : 1;
    const x = (e.clientX - rect.left) * k;
    const y = (e.clientY - rect.top) * k;

    // Nearest dot in 2D, so a vertical stack snaps to the one the cursor is level with.
    let nearest = -1;
    let nearestDist = HIT_SNAP_RADIUS_PX;
    data.hitDots.forEach((dot, i) => {
      const dist = Math.hypot(dot.xPx - x, dot.yPx - y);
      if (dist <= nearestDist) { nearest = i; nearestDist = dist; }
    });
    if (nearest !== -1) {
      const dot = data.hitDots[nearest];
      setActiveDot(nearest);
      TooltipManager.showAtPoint(rect.left + dot.xPx / k, rect.top + dot.yPx / k, buildClipTooltipHtml('onfield', dot.row, dot.hitNumber));
      return;
    }

    setActiveDot(null);
    // Later segments draw on top, so the last one under the cursor wins.
    const inClipBand = y >= CLIP_INSET_PX && y <= ROW_HEIGHT_PX - CLIP_INSET_PX;
    const segment = inClipBand ? [...data.segments].reverse().find(s => x >= s.xPx && x < s.xPx + s.widthPx) : undefined;
    if (segment) TooltipManager.showAtPoint(e.clientX, e.clientY, buildClipTooltipHtml(segment.type, segment.row));
    else TooltipManager.hide();
  };

  const handleLeave = () => {
    setActiveDot(null);
    TooltipManager.hide();
  };

  return (
    <div
      className="timeline-row"
      style={{ height: ROW_HEIGHT_PX, '--char-theme-raw': data.themeColor } as React.CSSProperties}
    >
      <div className="timeline-row-header" style={{ width: HEADER_COL_WIDTH_PX }}>
        <img className="timeline-row-icon" src={CommonUtils.getIconPath(data.unit, IMAGE_FOLDERS.CHARACTERS)} alt={data.unit} />
        <span className="timeline-row-name">{data.unit}</span>
      </div>
      <div className="timeline-row-track" onMouseMove={handleMove} onMouseLeave={handleLeave}>
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
            className={`timeline-hit-dot${i === activeDot ? ' is-active' : ''}`}
            style={{ left: dot.xPx, top: dot.yPx }}
          />
        ))}
      </div>
    </div>
  );
};
