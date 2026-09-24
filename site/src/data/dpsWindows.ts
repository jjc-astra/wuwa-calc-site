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

// Default for the per-window breakdown panels (DMG Contribution, Rotation Time).
export const DEFAULT_BREAKDOWN_WINDOW: DpsWindowKey = 'avgLoop';

// The window to actually show: a rotation with no loop has no loop windows, so those fall back to 2-Min.
export const shownWindow = (window: DpsWindowKey, stats: DpsStats | undefined): DpsWindowKey =>
  stats && stats[dpsFieldOf(window)] === null ? 'twoMin' : window;
