import type { MechanicNode, StanceChange } from '../types';
import { toFrames } from './Frames';

// Stance changes in authored order; legacy stanceResult/stanceTime reads as one.
export function getStanceChanges(node: MechanicNode): StanceChange[] {
  if (node.stanceChanges) return node.stanceChanges;
  if (node.stanceResult && node.stanceResult !== 'Retain') {
    return [{ stance: node.stanceResult, time: node.stanceTime ?? toFrames(0) }];
  }
  return [];
}

export const stanceChangeFrames = (change: StanceChange): number => parseFloat(String(change.time)) || 0;

// By time; ties keep authored order.
export function sortedStanceChanges(node: MechanicNode): Array<{ stance: StanceChange['stance']; frame: number }> {
  return getStanceChanges(node)
    .map(c => ({ stance: c.stance, frame: stanceChangeFrames(c) }))
    .sort((a, b) => a.frame - b.frame);
}
