// src/components/timeline/TimelineRow.tsx
import React from 'react';
import { CommonUtils } from '../../utils/Common';
import { IMAGE_FOLDERS } from '../../data/db';
import { TimelineClip } from './TimelineClip';
import { HEADER_COL_WIDTH_PX, ROW_HEIGHT_PX, simultaneousLineHeightPx } from './timelineLayout';
import type { UnitRowData } from './timelineLayout';

interface TimelineRowProps {
  data: UnitRowData;
}

export const TimelineRow: React.FC<TimelineRowProps> = ({ data }) => (
  <div
    className="timeline-row"
    style={{ height: ROW_HEIGHT_PX, '--char-theme-raw': data.themeColor } as React.CSSProperties}
  >
    <div className="timeline-row-header" style={{ width: HEADER_COL_WIDTH_PX }}>
      <img className="timeline-row-icon" src={CommonUtils.getIconPath(data.unit, IMAGE_FOLDERS.CHARACTERS)} alt={data.unit} />
      <span className="timeline-row-name">{data.unit}</span>
    </div>
    <div className="timeline-row-track">
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
    </div>
  </div>
);
