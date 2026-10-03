import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '../utils/safeLocalStorage';

interface TimelineViewState {
  // Effects active the entire rotation (always-on passives and the like) shown.
  showPermanent: boolean;
  // Collapsed effect sections and units, by id (see RotationTimeline's effect sections).
  collapsed: string[];
  setShowPermanent: (show: boolean) => void;
  toggleCollapsed: (id: string) => void;
}

/** The Calculator Timeline's view choices, kept across visits. */
export const useTimelineViewStore = create<TimelineViewState>()(
  persist(
    set => ({
      showPermanent: false,
      collapsed: [],
      setShowPermanent: show => set({ showPermanent: show }),
      toggleCollapsed: id => set(state => ({
        collapsed: state.collapsed.includes(id) ? state.collapsed.filter(c => c !== id) : [...state.collapsed, id]
      }))
    }),
    { name: 'wuwa_timeline_view', storage: persistStorage() }
  )
);
