import React from 'react';
import { Dropdown } from '../common/Dropdown';
import { DPS_WINDOWS } from '../../data/dpsWindows';
import type { DpsWindowKey } from '../../types/results';

const OPTIONS = DPS_WINDOWS.map(window => ({ value: window.key, label: window.label }));

/** The DPS window dropdown in a results card's header. */
export const DpsWindowSelect: React.FC<{ value: DpsWindowKey; onChange: (window: DpsWindowKey) => void }> = ({ value, onChange }) => (
  <Dropdown className="base-select text-xs results-dps-type-select" value={value} onChange={v => onChange(v as DpsWindowKey)} options={OPTIONS} />
);
