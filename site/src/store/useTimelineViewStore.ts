import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '../utils/safeLocalStorage';

interface TimelineViewState {
  // Show always-on effects.
  showPermanent: boolean;
  // Collapsed section ids (open by default).
  collapsed: string[];
  // Expanded unit ids (collapsed by default).
  expandedUnits: string[];
  // Time column counts down from 2:00.
  timeCountdown: boolean;
  setShowPermanent: (show: boolean) => void;
  toggleCollapsed: (id: string) => void;
  toggleUnitExpanded: (id: string) => void;
  toggleTimeCountdown: () => void;
}

const toggled = (list: string[], id: string): string[] => (list.includes(id) ? list.filter(c => c !== id) : [...list, id]);

/** Persisted Timeline and rotation table view options. */
export const useTimelineViewStore = create<TimelineViewState>()(
  persist(
    set => ({
      showPermanent: false,
      collapsed: [],
      expandedUnits: [],
      timeCountdown: false,
      setShowPermanent: show => set({ showPermanent: show }),
      toggleCollapsed: id => set(state => ({ collapsed: toggled(state.collapsed, id) })),
      toggleUnitExpanded: id => set(state => ({ expandedUnits: toggled(state.expandedUnits, id) })),
      toggleTimeCountdown: () => set(state => ({ timeCountdown: !state.timeCountdown }))
    }),
    { name: 'wuwa_timeline_view', storage: persistStorage() }
  )
);
