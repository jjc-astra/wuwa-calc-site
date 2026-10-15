// localStorage for Zustand persist that swallows storage errors.
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

export const persistStorage = <S,>() => createJSONStorage<S>(() => safeLocalStorage);
