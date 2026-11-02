import { Dropdown } from '../common/Dropdown';
import { DPS_WINDOWS, ENDING_SERIES, type DmgOverTimeKey } from '../../data/dpsWindows';
import type { DpsWindowKey } from '../../types/results';

const OPTIONS = DPS_WINDOWS.map(window => ({ value: window.key, label: window.label }));
const OPTIONS_WITH_ENDING = [...OPTIONS, { value: ENDING_SERIES.key, label: ENDING_SERIES.label }];

interface DpsWindowSelectProps<K extends DmgOverTimeKey> {
  value: K;
  onChange: (window: K) => void;
  // Adds Ending (Dmg Over Time only).
  withEnding?: boolean;
}

/** The DPS window dropdown in a results card's header. */
export const DpsWindowSelect = <K extends DmgOverTimeKey = DpsWindowKey>({ value, onChange, withEnding }: DpsWindowSelectProps<K>) => (
  <Dropdown className="base-select text-xs results-dps-type-select" value={value} onChange={v => onChange(v as K)} options={withEnding ? OPTIONS_WITH_ENDING : OPTIONS} />
);
