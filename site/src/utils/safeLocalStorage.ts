// A localStorage StateStorage for Zustand's persist middleware that swallows QuotaExceededError
// (and any other storage failure): a failed save only means the change won't survive a reload,
// never a crash of the action that caused it. Every persisted store shares one quota.
import { createJSONStorage, type StateStorage } from 'zustand/middleware';

const safeLocalStorage: StateStorage = {
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
