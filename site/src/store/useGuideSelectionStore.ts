import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '../utils/safeLocalStorage';
import type { GuideConfig } from '../components/guide/guideModel';
import type { RangeValue } from '../components/common/RangeSlider';

// What the Character Guide had selected for a character, so a refresh or a later visit reopens
// it. A character with nothing saved (or a Reset) opens on the default.
export interface GuideSelection {
  config: GuideConfig | null;
  rankRange: RangeValue;
  // Weapons added to the Weapon Comparison.
  addedWeapons?: string[];
}

interface GuideSelectionState {
  selections: Record<string, GuideSelection>;
  setSelection: (character: string, selection: GuideSelection) => void;
}

export const useGuideSelectionStore = create<GuideSelectionState>()(
  persist(
    set => ({
      selections: {},
      setSelection: (character, selection) => set(state => ({ selections: { ...state.selections, [character]: selection } }))
    }),
    {
      name: 'wuwa_guide_selection',
      storage: persistStorage()
    }
  )
);
