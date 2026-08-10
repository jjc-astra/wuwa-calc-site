import React from 'react';

interface PanelInfoItemProps {
  label: string;
  value: React.ReactNode;
  extraClass?: string;
}

export const PanelInfoItem: React.FC<PanelInfoItemProps> = ({
  label,
  value,
  extraClass = ''
}) => {
  return (
    <div className="panel-info-item">
      <span className="panel-info-label">{label}</span>
      <div className={`panel-info-value ${extraClass}`}>{value}</div>
    </div>
  );
};