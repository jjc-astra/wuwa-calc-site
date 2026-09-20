import type { MechanicNode, StanceChange } from '../types';

// A move's mid-move stance changes, in authored order. Nodes saved before `stanceChanges` existed
// carried one change as stanceResult/stanceTime (a missing time meant 0); those read as one entry.
export function getStanceChanges(node: MechanicNode): StanceChange[] {
  if (node.stanceChanges) return node.stanceChanges;
  if (node.stanceResult && node.stanceResult !== 'Retain') {
    return [{ stance: node.stanceResult, time: node.stanceTime ?? 0 }];
  }
  return [];
}

export const stanceChangeFrames = (change: StanceChange): number => parseFloat(String(change.time)) || 0;

// Changes ordered by when they land; ties keep authored order, so the later one wins.
export function sortedStanceChanges(node: MechanicNode): Array<{ stance: StanceChange['stance']; frame: number }> {
  return getStanceChanges(node)
    .map(c => ({ stance: c.stance, frame: stanceChangeFrames(c) }))
    .sort((a, b) => a.frame - b.frame);
}
