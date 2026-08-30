// src/components/common/BuffCard.tsx
import React from 'react';
import { tip } from '../../utils/Common';

export interface BuffEffectItem {
  label: string;
  value: string | number;
  stacks?: number;
}

interface BuffCardProps {
  source: string;
  effects: BuffEffectItem[];
}

export const BuffCard: React.FC<BuffCardProps> = ({ source, effects }) => {
  return (
    <div className="buff-card">
      <div className="buff-card-header">
        <span className="buff-source">{source}</span>
      </div>
      <div className="buff-card-body">
        {effects.map((e, idx) => (
          <div
            key={idx}
            className="buff-effect-row"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', width: '100%' }}
          >
            <div
              className="buff-label-wrap"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: '1 1 auto', overflow: 'hidden' }}
            >
              <svg
                className="buff-arrow"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ flexShrink: 0, width: '14px', height: '14px' }}
              >
                <polyline points="15 10 20 15 15 20"></polyline>
                <path d="M4 4v7a4 4 0 0 0 4 4h12"></path>
              </svg>
              <span
                className="buff-effect-label"
                style={{ flex: '1 1 auto', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                {...tip(e.label)}
              >
                {e.label}:
              </span>
            </div>
            <div className="buff-value-wrap" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
              <span className="buff-val-box">{e.value}</span>
              <span className="buff-stacks">x{e.stacks || 1}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};