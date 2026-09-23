// src/store/useRotationHistoryStore.ts
// One row per successful Calculate press (wired in from useRotationStore.calculateDamage).
// Newest-first in the Results panel's History tab.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '../utils/safeLocalStorage';
import type { TeamSlot, EnemyStats } from '../types/index';
import type { RotationResults } from '../types/results';
import type { RotationRowFields } from './useRotationStore';

export interface HistoryEntry {
  id: string;
  timestamp: number;
  isFavorite: boolean;
  team: TeamSlot[];
  // No `id` -- see toSavedRow, the shape this is always populated from.
  rotation: RotationRowFields[];
  settings: { startEnergy: boolean; startConcerto: boolean; endingRotationEnabled?: boolean; endRotationStartsEarlier?: boolean };
  results: RotationResults;
  // The target it was calculated against. Absent on entries saved before it was recorded, which
  // used the default target.
  enemy?: EnemyStats;
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
    {
      name: 'wuwa_calc_rotation_history',
      storage: persistStorage(),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Drops any entry missing its core fields, so a malformed persisted entry can't crash
        // the History tab's render.
        state.entries = state.entries.filter(e => e && e.id && Array.isArray(e.rotation) && Array.isArray(e.team) && e.results);
      }
    }
  )
);
