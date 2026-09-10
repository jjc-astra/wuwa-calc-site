// src/store/useRotationHistoryStore.ts
// One row per successful Calculate press (wired in from useRotationStore.calculateDamage).
// Newest-first in the Results panel's History tab.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TeamSlot } from '../types/index';
import type { RotationResults } from '../types/results';
import type { RotationRow } from './useRotationStore';

export interface HistoryEntry {
  id: string;
  timestamp: number;
  isFavorite: boolean;
  team: TeamSlot[];
  rotation: RotationRow[];
  settings: { startEnergy: boolean; startConcerto: boolean; endingRotationEnabled?: boolean; endRotationStartsEarlier?: boolean };
  results: RotationResults;
}

// Favorited entries are never auto-evicted; only the 10 most recent non-favorite entries are
// kept. Favoriting is how you keep something past the rolling window.
const MAX_NON_FAVORITE = 10;

interface RotationHistoryState {
  entries: HistoryEntry[];
  addEntry: (entry: Omit<HistoryEntry, 'id' | 'timestamp' | 'isFavorite'>) => void;
  toggleFavorite: (id: string) => void;
  removeEntry: (id: string) => void;
}

export const useRotationHistoryStore = create<RotationHistoryState>()(
  persist(
    set => ({
      entries: [],

      addEntry: entry => {
        const newEntry: HistoryEntry = {
          ...entry,
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          isFavorite: false
        };
        set(state => {
          const withNew = [newEntry, ...state.entries];
          let nonFavSeen = 0;
          const trimmed = withNew.filter(e => {
            if (e.isFavorite) return true;
            nonFavSeen++;
            return nonFavSeen <= MAX_NON_FAVORITE;
          });
          return { entries: trimmed };
        });
      },

      toggleFavorite: id => {
        set(state => ({
          entries: state.entries.map(e => (e.id === id ? { ...e, isFavorite: !e.isFavorite } : e))
        }));
      },

      removeEntry: id => {
        set(state => ({ entries: state.entries.filter(e => e.id !== id) }));
      }
    }),
    { name: 'wuwa_calc_rotation_history' }
  )
);
