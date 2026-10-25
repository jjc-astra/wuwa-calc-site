import React from 'react';
import { tip } from '../../utils/Common';

interface PanelInfoItemProps {
  label: string;
  value: React.ReactNode;
  extraClass?: string;
  tooltip?: string;
}

/** A caps label over a value. */
export const PanelInfoItem: React.FC<PanelInfoItemProps> = ({
  label,
  value,
  extraClass = '',
  tooltip
}) => {
  return (
    <div className="panel-info-item" {...(tooltip ? tip(tooltip) : {})}>
      <span className="panel-info-label caps-label">{label}</span>
      <div className={`panel-info-value ${extraClass}`}>{value}</div>
    </div>
  );
};