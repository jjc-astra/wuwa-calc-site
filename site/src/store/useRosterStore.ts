import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage } from '../utils/safeLocalStorage';
import type { TeamSlot, EnemyStats } from '../types';
import {
  defaultEnemyStats,
  DEFAULT_SUBSTATS,
  DEFAULT_ECHO_LAYOUT,
  costsForLayout,
  mainStatOptionsFor,
  SECONDARY_MAIN_STATS,
  MAIN_STAT_VALUES,
  STAT_DB,
  STAT_NAME_MAP
} from '../data/db';
import { DataLoader } from '../utils/DataLoader';
import { CombatCalculator } from '../logic/CombatCalculator';
import { useRotationStore } from './useRotationStore';
import { CommonUtils } from '../utils/Common';
import { getTeamEntityRefs, slotFieldFolder } from '../utils/TeamUtils';
import { SYSTEM_NAMESPACE } from '../utils/MechanicKey';
import { effectiveTriggerRule } from '../logic/EventManager';
import { applyBuilderOverridesForTeam } from '../workers/builderOverridePayload';
import { emptyEchoStats } from '../data/gameVocab';

const defaultLayoutMainStats = (layout: string): string[] =>
  costsForLayout(layout).map(cost => mainStatOptionsFor(cost)[0] || '');

const createEmptySlot = (index: number): TeamSlot => {
  const layout = DEFAULT_ECHO_LAYOUT;
  const defaultMainStats = defaultLayoutMainStats(layout);
  const slot: TeamSlot = {
    index,
    character: '',
    sequence: 0,
    mode: 'None',
    weapon: '',
    rank: 1,
    layout,
    mainSet: '',
    subSet: '',
    subSet2a: '',
    subSet2b: '',
    mainEcho: '',
    echoes: Array(5).fill(null).map((_, i) => ({
      mainStat: defaultMainStats[i] || '',
      substats: Array(5).fill(null).map((_, j) => ({
        name: DEFAULT_SUBSTATS[j] || 'N/A',
        value: ''
      }))
    })),
    echoStats: emptyEchoStats()
  };
  slot.echoStats = calculateEchoStatsForSlot(slot);
  return slot;
};

// The stats a slot's five echoes add up to: main stats, secondary main stats and substats.
export const calculateEchoStatsForSlot = (slot: TeamSlot) => {
  const echoStats = { ...slot.echoStats };
  Object.keys(echoStats).forEach(k => ((echoStats as any)[k] = 0));
  const costs = costsForLayout(slot.layout);

  slot.echoes.forEach((echo, i) => {
    const cost = costs[i];
    if (SECONDARY_MAIN_STATS[cost]) {
      const sec = SECONDARY_MAIN_STATS[cost];
      (echoStats as any)[sec.stat] += sec.value;
    }
    if (echo.mainStat && MAIN_STAT_VALUES[cost]?.[echo.mainStat]) {
      const internalKey = STAT_NAME_MAP[echo.mainStat];
      if (internalKey) (echoStats as any)[internalKey] += MAIN_STAT_VALUES[cost][echo.mainStat];
    }
    echo.substats.forEach(sub => {
      if (sub.name !== 'N/A' && sub.value) {
        const internalKey = STAT_NAME_MAP[sub.name];
        const numVal = parseFloat(String(sub.value));
        if (internalKey && !isNaN(numVal)) (echoStats as any)[internalKey] += numVal;
      }
    });
  });
  return echoStats;
};

// A character's recommended build from db_builds.json (its first listed role), if it has one.
export const recommendedBuildFor = (character: string): any | undefined => {
  const builds = DataLoader.buildDB[character];
  const roles = builds ? Object.keys(builds) : [];
  return roles.length > 0 ? builds[roles[0]] : undefined;
};

// A recommended build's echo layout, main stats and default-roll substats, on this slot's five
// echoes. Sets, main echo and weapon are left alone.
export function recommendedEchoes(slot: TeamSlot, build: any): Pick<TeamSlot, 'layout' | 'echoes'> {
  const layout = build.echoLayout || slot.layout;
  const costs = costsForLayout(layout);
  const remainingSubs = { ...(build.subStats || {}) };
  const subStatKeys = Object.keys(remainingSubs);
  const statDataRaw = build.mainStats;

  const echoes = slot.echoes.map((echo, i) => {
    const cost = costs[i];
    let targetMainStat = '';
    const statData = statDataRaw ? statDataRaw[`cost${cost}`] : null;
    if (statData) {
      if (Array.isArray(statData)) {
        const countSoFar = costs.slice(0, i).filter(c => c === cost).length;
        targetMainStat = statData[countSoFar] || statData[0];
      } else {
        targetMainStat = statData;
      }
    }

    const usedOnThisEcho = new Set<string>();
    const substats = echo.substats.map(() => {
      let targetSub = 'N/A';
      for (const key of subStatKeys) {
        if (remainingSubs[key] > 0 && !usedOnThisEcho.has(key)) {
          targetSub = key;
          remainingSubs[key]--;
          usedOnThisEcho.add(key);
          break;
        }
      }
      let val: string | number = '';
      if (targetSub !== 'N/A' && STAT_DB[targetSub]) {
        const defaultIdx = STAT_DB[targetSub].defaultIndex || 0;
        val = STAT_DB[targetSub].values[defaultIdx];
      }
      return { name: targetSub, value: val };
    });

    return { mainStat: targetMainStat || echo.mainStat, substats };
  });

  return { layout, echoes };
}

// Publishes a new team: the Builder edits for its members are replayed onto the DataLoader first.
const publishTeam = (team: TeamSlot[]) => {
  applyBuilderOverridesForTeam(team);
  useRosterStore.setState({ team });
};

// publishTeam, then re-run the rotation against the new team.
const commitTeam = (team: TeamSlot[]) => {
  publishTeam(team);
  useRotationStore.getState().recalculate();
};

interface RosterState {
  team: TeamSlot[];
  enemy: EnemyStats;
  setSlotField: (slotIndex: number, field: keyof TeamSlot, value: any) => Promise<void>;
  clearSlot: (slotIndex: number) => void;
  setSubstat: (slotIndex: number, echoIndex: number, subIndex: number, name: string, value: string | number) => void;
  setEnemyField: (field: 'level' | 'res' | 'hp', value: number) => void;
  // Replaces the target without recalculating -- for loaders that recalculate right after.
  setEnemy: (enemy: EnemyStats) => void;
  importTeam: (teamData: TeamSlot[]) => Promise<void>;
  applyRecommendedBuild: (slotIndex: number, charName: string) => Promise<void>;
  getIdleStats: (slotIndex: number) => any;
}

// The Calculator's team and target.
export const useRosterStore = create<RosterState>()(
  persist(
    (set, get) => ({
      team: [createEmptySlot(0), createEmptySlot(1), createEmptySlot(2)],
      enemy: defaultEnemyStats(),

      applyRecommendedBuild: async (slotIndex, charName) => {
        const build = recommendedBuildFor(charName);
        if (!build) return;
        const team = [...get().team];
        const slot = { ...team[slotIndex], character: charName };

        if (build.weapon) {
          slot.weapon = build.weapon;
          await DataLoader.loadMechanic('weapons', build.weapon);
        }
        if (build.mainSet) {
          slot.mainSet = build.mainSet;
          await DataLoader.loadMechanic('sets', build.mainSet);
        }
        if (build.subSet) {
          slot.subSet = build.subSet;
          await DataLoader.loadMechanic('sets', build.subSet);
        } else {
          slot.subSet = '';
        }
        if (build.mainEcho) {
          slot.mainEcho = build.mainEcho;
          await DataLoader.loadMechanic('echoes', build.mainEcho);
        }

        Object.assign(slot, recommendedEchoes(slot, build));
        slot.echoStats = calculateEchoStatsForSlot(slot);
        team[slotIndex] = slot;
        commitTeam(team);
      },

      setSlotField: async (slotIndex, field, value) => {
        const team = [...get().team];
        const slot = { ...team[slotIndex], [field]: value };

        if (field === 'layout') {
          const costs = costsForLayout(value);
          slot.echoes = slot.echoes.map((echo, i) => {
            const validOptions = mainStatOptionsFor(costs[i]);
            return {
              ...echo,
              mainStat: validOptions.includes(echo.mainStat) ? echo.mainStat : validOptions[0] || ''
            };
          });
        } else if (field === 'character' && value) {
          slot.weapon = '';
          slot.mode = 'None';
          await DataLoader.loadMechanic('characters', value);
          team[slotIndex] = slot;
          publishTeam(team);
          await get().applyRecommendedBuild(slotIndex, value);
          return;
        } else {
          // A field that names an item (weapon, a set, the main echo) needs its mechanics loaded.
          const folder = slotFieldFolder(field);
          if (folder && value) await DataLoader.loadMechanic(folder, value);
        }

        const isOnePcSet = DataLoader.onePcSets.includes(slot.mainSet);

        // A 1pc main set is worn as the main-slot echo itself -- there's no separate main-slot
        // echo pick to make, so any stale one from a previous mainSet is dropped.
        if (field === 'mainSet' && isOnePcSet) slot.mainEcho = '';

        if ((field === 'mainSet' || field === 'subSet') && !isOnePcSet) {
          if (slot.mainEcho && slot.mainSet && !DataLoader.allowedMainEchoes(slot).includes(slot.mainEcho)) {
            slot.mainEcho = '';
          }
        }

        slot.echoStats = calculateEchoStatsForSlot(slot);
        team[slotIndex] = slot;
        commitTeam(team);
      },

      // Resets one roster row back to the same blank slot a fresh team starts with -- unlike
      // setSlotField('character', ''), which only clears the character field and leaves its
      // weapon/sets/echoes behind as stale leftovers.
      clearSlot: (slotIndex) => {
        const team = [...get().team];
        team[slotIndex] = createEmptySlot(slotIndex);
        commitTeam(team);
      },

      setSubstat: (slotIndex, echoIndex, subIndex, name, value) => {
        const team = [...get().team];
        const slot = { ...team[slotIndex] };
        const echoes = [...slot.echoes];
        const echo = { ...echoes[echoIndex] };
        const substats = [...echo.substats];

        substats[subIndex] = { name, value };
        echo.substats = substats;
        echoes[echoIndex] = echo;
        slot.echoes = echoes;

        slot.echoStats = calculateEchoStatsForSlot(slot);
        team[slotIndex] = slot;
        set({ team });
        useRotationStore.getState().recalculate();
      },

      setEnemy: enemy => set({ enemy: { ...enemy } }),

      setEnemyField: (field, value) => {
        set(state => ({ enemy: { ...state.enemy, [field]: value } }));
        useRotationStore.getState().recalculate();
      },

      importTeam: async teamData => {
        if (!Array.isArray(teamData)) return;
        const current = get().team;
        const merged = current.map((existing, i) => ({ ...existing, ...(teamData[i] || {}), index: i }));

        await DataLoader.loadTeamMechanics(merged);
        merged.forEach(slot => { slot.echoStats = calculateEchoStatsForSlot(slot); });
        publishTeam(merged);
        // Awaited (unlike sibling recalculate() calls) -- importRotation() fires its own
        // recalculate() right after, and without waiting these two race on the same async
        // checkTeamFreshness() gap, letting a stale response silently overwrite fresh rows.
        await useRotationStore.getState().recalculate();
      },

      getIdleStats: slotIndex => {
        const team = get().team;
        const slot = team[slotIndex];
        if (!slot || !slot.character) return {};

        const activeBuffs: any[] = [];

        // `rank` only passed for weapon sources -- resolves slash-delimited rank-scaled values
        // (e.g. "12/15/18/21/24%") via CommonUtils.parseRankValue; other sources never use it.
        const applyBuffsFromSource = (sourceName: string, isSelf: boolean, rank?: number) => {
          (DataLoader.mechanicsIndex[sourceName] || []).forEach(mechId => {
            const mech = DataLoader.mechanicsDB[mechId];
            if (!mech?.effects || !effectiveTriggerRule(mech)?.trim().startsWith('ALWAYS')) return;

            mech.effects.forEach(eff => {
              if (eff.type === 'buff' && eff.stat) {
                const appliesToSelf =
                  (eff.target === '@Self' || eff.target === '@Equipper') && isSelf;
                const appliesToTeam = eff.target === '@Team';
                const appliesToOthers = eff.target === '@TeamOthers' && !isSelf;
                if (appliesToSelf || appliesToTeam || appliesToOthers) {
                  const value = rank !== undefined ? CommonUtils.parseRankValue(eff.value, rank) : eff.value;
                  activeBuffs.push({
                    stat: eff.stat,
                    value,
                    stacks: eff.maxStacks || 1
                  });
                }
              }
            });
          });
        };

        // Everything one slot wears, plus the character itself.
        const applyBuffsFromSlot = (owner: TeamSlot, isSelf: boolean) => {
          getTeamEntityRefs([owner], { includeSystem: false }).forEach(ref =>
            applyBuffsFromSource(ref.name, isSelf, ref.folder === 'weapons' ? owner.rank : undefined));
        };

        team.forEach((tSlot, tIndex) => {
          if (tIndex !== slotIndex && tSlot.character) applyBuffsFromSlot(tSlot, false);
        });
        applyBuffsFromSlot(slot, true);
        applyBuffsFromSource(SYSTEM_NAMESPACE, true);

        return CombatCalculator.calculateFinalStats(slot.character, activeBuffs, team);
      }
    }),
    {
      name: 'wuwa_calc_team_cache',
      storage: persistStorage(),
      onRehydrateStorage: () => {
        return (state, error) => {
          if (!error && state) {
            // Await initDatabases() before applying team overrides to prevent missing base-stat lookups during Zustand rehydration.
            DataLoader.ready.then(() =>
              Promise.all(
                getTeamEntityRefs(state.team, { includeSystem: false, dedupe: true }).map(ref => DataLoader.loadMechanic(ref.folder, ref.name))
              ).then(() => applyBuilderOverridesForTeam(state.team))
            );
          }
        };
      }
    }
  )
);