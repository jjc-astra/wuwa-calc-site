// The windows a rotation's DPS is reported over, in display order. Every place that lists them
// (result tabs, chart pickers, the DPS panel, rankings) and every place that keys by them
// (contribution, damage-over-time, the DPS stat fields) reads this one list.
import type { DpsStats } from '../types/results';

interface DpsWindowDef {
  key: string;
  // Short name, for tabs and dropdowns.
  label: string;
  // Which DpsStats field holds this window's DPS, and how the DPS panel labels it.
  dpsField: keyof DpsStats;
  dpsLabel: string;
}

export const DPS_WINDOWS = [
  { key: 'opener', label: 'Opener', dpsField: 'openerDps', dpsLabel: 'Opener DPS' },
  { key: 'firstLoop', label: 'First Loop', dpsField: 'firstLoopDps', dpsLabel: 'First Loop DPS' },
  { key: 'avgLoop', label: 'Avg Loop', dpsField: 'avgLoopDps', dpsLabel: 'Avg Loop DPS' },
  { key: 'twoMin', label: '2-Min', dpsField: 'twoMinDps', dpsLabel: '2-Minute DPS' }
] as const satisfies readonly DpsWindowDef[];

export type DpsWindowKey = typeof DPS_WINDOWS[number]['key'];

export const dpsFieldOf = (window: DpsWindowKey): keyof DpsStats =>
  DPS_WINDOWS.find(w => w.key === window)!.dpsField;
