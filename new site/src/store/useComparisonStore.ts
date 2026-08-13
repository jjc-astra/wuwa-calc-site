import { create } from 'zustand';
import { generateMockDpsStats, generateMockDmgOverTimeSeries } from '../data/mockResults';
import type { DpsStats, DmgOverTimeSeries } from '../data/mockResults';

export interface PinnedRotation {
  label: string;
  dpsStats: DpsStats;
  dmgOverTimeSeries: DmgOverTimeSeries;
}

interface ComparisonState {
  pinned: PinnedRotation | null;
  pinFromFile: (file: File) => Promise<void>;
  unpin: () => void;
}

// Same team-name-based label convention as RotationBuilder's JSON export, so a pinned file
// reads the same way it would if re-exported.
function labelFromTeam(team: Array<{ character?: string; weapon?: string }> | undefined): string {
  if (!team) return 'Imported Rotation';
  const names = team
    .filter(s => s.character)
    .map(s => {
      let id = String(s.character).replace(/\s+/g, '');
      if (s.weapon) {
        const initials = s.weapon.match(/\b\w/g) || [];
        id += `-${initials.join('').toUpperCase()}`;
      }
      return id;
    });
  return names.length > 0 ? names.join(' / ') : 'Imported Rotation';
}

export const useComparisonStore = create<ComparisonState>()((set) => ({
  pinned: null,

  // The imported rotation's own DPS/dmg-over-time isn't actually recalculated yet -- only its
  // label is real, seeded off the file's content so the same file always renders the same
  // mock numbers.
  pinFromFile: async (file: File) => {
    const text = await file.text();
    let label = file.name.replace(/\.json$/i, '');
    try {
      const parsed = JSON.parse(text);
      label = labelFromTeam(parsed.team);
    } catch {
      // Keep the filename-derived label if the file isn't valid/expected JSON.
    }

    const seed = `${label}:${text.length}`;
    set({
      pinned: {
        label,
        dpsStats: generateMockDpsStats(seed),
        dmgOverTimeSeries: generateMockDmgOverTimeSeries(seed, label)
      }
    });
  },

  unpin: () => set({ pinned: null })
}));
