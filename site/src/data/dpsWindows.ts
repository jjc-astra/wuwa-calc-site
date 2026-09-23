// The windows a rotation's DPS is reported over, in display order. Every place that lists them
// (result tabs, chart pickers, the DPS panel, rankings) and every place that keys by them
// (contribution, damage-over-time, the DPS stat fields) reads this one list.
import type { DpsStats } from '../types/results';

interface DpsWindowDef {
  key: string;
  // Short name, for tabs, dropdowns and the DPS panel.
  label: string;
  // Which DpsStats field holds this window's DPS.
  dpsField: keyof DpsStats;
}

export const DPS_WINDOWS = [
  { key: 'opener', label: 'Opener', dpsField: 'openerDps' },
  { key: 'firstLoop', label: 'First Loop', dpsField: 'firstLoopDps' },
  { key: 'avgLoop', label: 'Avg Loop', dpsField: 'avgLoopDps' },
  { key: 'twoMin', label: '2-Min', dpsField: 'twoMinDps' }
] as const satisfies readonly DpsWindowDef[];

export type DpsWindowKey = typeof DPS_WINDOWS[number]['key'];

export const dpsFieldOf = (window: DpsWindowKey): keyof DpsStats =>
  DPS_WINDOWS.find(w => w.key === window)!.dpsField;
