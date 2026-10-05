import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '../utils/safeLocalStorage';

interface TimelineViewState {
  // Effects active the entire rotation (always-on passives and the like) shown.
  showPermanent: boolean;
  // Collapsed effect sections, by id (see RotationTimeline's effect sections). Open by default.
  collapsed: string[];
  // Units whose effects are shown, by id. Collapsed by default: just their moves.
  expandedUnits: string[];
  setShowPermanent: (show: boolean) => void;
  toggleCollapsed: (id: string) => void;
  toggleUnitExpanded: (id: string) => void;
}

// `list` with `id` added, or taken out if it's there.
const toggled = (list: string[], id: string): string[] => (list.includes(id) ? list.filter(c => c !== id) : [...list, id]);

/** The Calculator Timeline's view choices, kept across visits. */
export const useTimelineViewStore = create<TimelineViewState>()(
  persist(
    set => ({
      showPermanent: false,
      collapsed: [],
      expandedUnits: [],
      setShowPermanent: show => set({ showPermanent: show }),
      toggleCollapsed: id => set(state => ({ collapsed: toggled(state.collapsed, id) })),
      toggleUnitExpanded: id => set(state => ({ expandedUnits: toggled(state.expandedUnits, id) }))
    }),
    { name: 'wuwa_timeline_view', storage: persistStorage() }
  )
);
