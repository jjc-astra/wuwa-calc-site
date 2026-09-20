import React from 'react';
import { tip } from '../../utils/Common';

export interface SegmentedOption<T> {
  value: T;
  label: React.ReactNode;
  tooltip?: string;
}

interface SegmentedToggleProps<T> {
  /** The active option's value. */
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}

/** A row of mutually exclusive buttons, the active one highlighted. */
export function SegmentedToggle<T extends string | number>({ value, options, onChange, ariaLabel }: SegmentedToggleProps<T>) {
  return (
    <div className="segmented-toggle" role="group" aria-label={ariaLabel}>
      {options.map(option => (
        <button
          key={String(option.value)}
          type="button"
          className={`segmented-toggle-btn ${option.value === value ? 'is-active' : ''}`}
          {...(option.tooltip ? tip(option.tooltip) : {})}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
