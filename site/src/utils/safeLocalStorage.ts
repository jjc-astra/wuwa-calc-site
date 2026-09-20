// A localStorage-backed StateStorage for Zustand's persist middleware that swallows
// QuotaExceededError (and any other storage failure) instead of letting it throw uncaught.
// The in-memory state update that triggered the save has already succeeded independently of
// persistence -- a failed save should just mean "this change won't survive a reload," not
// crash the action the user just took. All six persisted stores share one localStorage quota
// per origin, so any of them hitting the ceiling would otherwise break every store's saves,
// not just its own.
import { createJSONStorage, type StateStorage } from 'zustand/middleware';

export const safeLocalStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(name),
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch (e) {
      console.warn(`[safeLocalStorage] Failed to persist "${name}" (likely over the localStorage quota) -- this change won't survive a reload until something frees up space.`, e);
    }
  },
  removeItem: (name) => localStorage.removeItem(name)
};

// What every persisted store passes as its `storage`: JSON in safeLocalStorage.
export const persistStorage = <S,>() => createJSONStorage<S>(() => safeLocalStorage);
