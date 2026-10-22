import React from 'react';
import { tip } from '../../utils/Common';

export interface SegmentedOption<T> {
  value: T;
  label: React.ReactNode;
  tooltip?: string;
}

interface SegmentedButtonsProps<T> {
  options: SegmentedOption<T>[];
  isActive: (value: T) => boolean;
  onClick: (value: T) => void;
  ariaLabel: string;
}

function SegmentedButtons<T extends string | number>({ options, isActive, onClick, ariaLabel }: SegmentedButtonsProps<T>) {
  return (
    <div className="segmented-toggle" role="group" aria-label={ariaLabel}>
      {options.map(option => (
        <button
          key={String(option.value)}
          type="button"
          className={`segmented-toggle-btn ${isActive(option.value) ? 'is-active' : ''}`}
          aria-pressed={isActive(option.value)}
          {...(option.tooltip ? tip(option.tooltip) : {})}
          onClick={() => onClick(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface SegmentedToggleProps<T> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}

export function SegmentedToggle<T extends string | number>({ value, options, onChange, ariaLabel }: SegmentedToggleProps<T>) {
  return <SegmentedButtons options={options} isActive={v => v === value} onClick={onChange} ariaLabel={ariaLabel} />;
}

interface SegmentedMultiToggleProps<T> {
  values: T[];
  options: SegmentedOption<T>[];
  onChange: (values: T[]) => void;
  ariaLabel: string;
}

/** Each segment toggles on its own; the last one can't be turned off. */
export function SegmentedMultiToggle<T extends string | number>({ values, options, onChange, ariaLabel }: SegmentedMultiToggleProps<T>) {
  const toggle = (value: T) => {
    if (!values.includes(value)) onChange(options.map(o => o.value).filter(v => v === value || values.includes(v)));
    else if (values.length > 1) onChange(values.filter(v => v !== value));
  };
  return <SegmentedButtons options={options} isActive={v => values.includes(v)} onClick={toggle} ariaLabel={ariaLabel} />;
}
