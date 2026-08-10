import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TeamSlot } from '../types';
import {
  ENEMY_DEFAULTS,
  DEFAULT_SUBSTATS,
  COST_DISTRIBUTION,
  SECONDARY_MAIN_STATS,
  MAIN_STAT_VALUES,
  MAIN_STATS_4_COST,
  MAIN_STATS_3_COST,
  MAIN_STATS_1_COST,
  STAT_DB,
  STAT_NAME_MAP
} from '../data/db';
import { DataLoader } from '../utils/DataLoader';
import { CombatCalculator } from '../logic/CombatCalculator';
import { useRotationStore } from './useRotationStore';

const defaultLayoutMainStats = (layout: string): string[] => {
  const costs = COST_DISTRIBUTION[layout] || [4, 3, 3, 1, 1];
  return costs.map(cost => {
    const options = cost === 4 ? MAIN_STATS_4_COST : cost === 3 ? MAIN_STATS_3_COST : MAIN_STATS_1_COST;
    return options[0] || '';
  });
};

const createEmptySlot = (index: number): TeamSlot => {
  const layout = '4 3 3 1 1';
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
    mainEcho: '',
    echoes: Array(5).fill(null).map((_, i) => ({
      mainStat: defaultMainStats[i] || '',
      substats: Array(5).fill(null).map((_, j) => ({
        name: DEFAULT_SUBSTATS[j] || 'N/A',
        value: ''
      }))
    })),
    echoStats: {
      flatHP: 0, percentHP: 0, flatAtk: 0, percentAtk: 0, flatDef: 0, percentDef: 0,
      critRate: 0, critDamage: 0, energyRegen: 0, healingBonus: 0,
      skillDmgBonus: 0, basicDmgBonus: 0, heavyDmgBonus: 0, libDmgBonus: 0,
      glacioDmgBonus: 0, fusionDmgBonus: 0, electroDmgBonus: 0, aeroDmgBonus: 0, spectroDmgBonus: 0, havocDmgBonus: 0
    }
  };
  slot.echoStats = calculateEchoStatsForSlot(slot);
  return slot;
};

export const calculateEchoStatsForSlot = (slot: TeamSlot) => {
  const echoStats = { ...slot.echoStats };
  Object.keys(echoStats).forEach(k => ((echoStats as any)[k] = 0));
  const costs = COST_DISTRIBUTION[slot.layout || '4 3 3 1 1'] || [4, 3, 3, 1, 1];

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

interface RosterState {
  team: TeamSlot[];
  enemy: { level: number; res: number; hp: number };
  setSlotField: (slotIndex: number, field: keyof TeamSlot, value: any) => Promise<void>;
  setSubstat: (slotIndex: number, echoIndex: number, subIndex: number, name: string, value: string | number) => void;
  setEnemyField: (field: 'level' | 'res' | 'hp', value: number) => void;
  importTeam: (teamData: TeamSlot[]) => Promise<void>;
  applyRecommendedBuild: (slotIndex: number, charName: string) => Promise<void>;
  getIdleStats: (slotIndex: number) => any;
}

export const useRosterStore = create<RosterState>()(
  persist(
    (set, get) => ({
      team: [createEmptySlot(0), createEmptySlot(1), createEmptySlot(2)],
      enemy: { level: ENEMY_DEFAULTS.level, res: ENEMY_DEFAULTS.res, hp: ENEMY_DEFAULTS.hp },

      applyRecommendedBuild: async (slotIndex, charName) => {
        if (!charName || !DataLoader.buildDB[charName]) return;
        const roles = Object.keys(DataLoader.buildDB[charName]);
        if (roles.length === 0) return;

        const build = DataLoader.buildDB[charName][roles[0]];
        const team = [...get().team];
        const slot = { ...team[slotIndex], character: charName };

        if (build.weapon) {
          slot.weapon = build.weapon;
          await DataLoader.loadMechanic('weapons', build.weapon);
        }
        if (build.echoLayout) {
          slot.layout = build.echoLayout;
        }
        if (build.mainSet) {
          slot.mainSet = build.mainSet;
          await DataLoader.loadMechanic('sets', build.mainSet);
        }
        const targetSubSet = build.subSet || build.subset || build.subSets || build.subsets;
        if (targetSubSet) {
          slot.subSet = targetSubSet;
          await DataLoader.loadMechanic('sets', targetSubSet);
        } else {
          slot.subSet = '';
        }
        if (build.mainEcho) {
          slot.mainEcho = build.mainEcho;
          await DataLoader.loadMechanic('echoes', build.mainEcho);
        }

        const costs = COST_DISTRIBUTION[slot.layout || '4 3 3 1 1'] || [4, 3, 3, 1, 1];
        let remainingSubs = { ...(build.subStats || build.substats || {}) };
        const subStatKeys = Object.keys(remainingSubs);

        const newEchoes = slot.echoes.map((echo, i) => {
          const cost = costs[i];
          let targetMainStat = '';
          const costKey = `cost${cost}`;
          const statDataRaw = build.mainStats || build.mainstats;
          const statData = statDataRaw ? statDataRaw[costKey] : null;

          if (statData) {
            if (Array.isArray(statData)) {
              const countSoFar = costs.slice(0, i).filter(c => c === cost).length;
              targetMainStat = statData[countSoFar] || statData[0];
            } else {
              targetMainStat = statData;
            }
          }

          let usedOnThisEcho = new Set<string>();
          const substats = echo.substats.map(() => {
            let targetSub = 'N/A';
            for (let key of subStatKeys) {
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

          return {
            mainStat: targetMainStat || echo.mainStat,
            substats
          };
        });

        slot.echoes = newEchoes;
        slot.echoStats = calculateEchoStatsForSlot(slot);
        team[slotIndex] = slot;
        set({ team });
        useRotationStore.getState().recalculate();
      },

      setSlotField: async (slotIndex, field, value) => {
        const team = [...get().team];
        const slot = { ...team[slotIndex], [field]: value };

        if (field === 'layout') {
          const costs = COST_DISTRIBUTION[value || '4 3 3 1 1'] || [4, 3, 3, 1, 1];
          slot.echoes = slot.echoes.map((echo, i) => {
            const cost = costs[i];
            const validOptions = cost === 4 ? MAIN_STATS_4_COST : cost === 3 ? MAIN_STATS_3_COST : MAIN_STATS_1_COST;
            return {
              ...echo,
              mainStat: validOptions.includes(echo.mainStat) ? echo.mainStat : validOptions[0] || ''
            };
          });
        } else if (field === 'character' && value) {
          slot.weapon = '';
          await DataLoader.loadMechanic('characters', value);
          team[slotIndex] = slot;
          set({ team });
          await get().applyRecommendedBuild(slotIndex, value);
          return;
        } else if (field === 'weapon' && value) {
          await DataLoader.loadMechanic('weapons', value);
        } else if (field === 'mainSet' && value) {
          await DataLoader.loadMechanic('sets', value);
        } else if (field === 'subSet' && value) {
          await DataLoader.loadMechanic('sets', value);
        }

        if (field === 'mainSet' || field === 'subSet') {
          const isTriggerSet = DataLoader.triggerSets.includes(slot.mainSet);
          let allowedEchoes: string[] = [];
          if (slot.mainSet) {
            if (DataLoader.setEchoMapping[slot.mainSet]) allowedEchoes.push(...DataLoader.setEchoMapping[slot.mainSet]);
            if (isTriggerSet && slot.subSet && DataLoader.setEchoMapping[slot.subSet]) {
              allowedEchoes.push(...DataLoader.setEchoMapping[slot.subSet]);
            }
            allowedEchoes = Array.from(new Set(allowedEchoes));
            if (allowedEchoes.length === 0) allowedEchoes = DataLoader.allMainEchoes;
          }
          if (slot.mainEcho && slot.mainSet && !allowedEchoes.includes(slot.mainEcho)) {
            slot.mainEcho = '';
          }
        }

        if (field === 'mainEcho' && value) {
          await DataLoader.loadMechanic('echoes', value);
        }

        slot.echoStats = calculateEchoStatsForSlot(slot);
        team[slotIndex] = slot;
        set({ team });
        useRotationStore.getState().recalculate();
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

      setEnemyField: (field, value) => {
        set(state => ({ enemy: { ...state.enemy, [field]: value } }));
        useRotationStore.getState().recalculate();
      },

      importTeam: async teamData => {
        if (!Array.isArray(teamData)) return;
        const current = get().team;
        const merged = current.map((existing, i) => ({ ...existing, ...(teamData[i] || {}), index: i }));

        for (const slot of merged) {
          if (slot.character) await DataLoader.loadMechanic('characters', slot.character);
          if (slot.weapon) await DataLoader.loadMechanic('weapons', slot.weapon);
          if (slot.mainSet) await DataLoader.loadMechanic('sets', slot.mainSet);
          if (slot.subSet) await DataLoader.loadMechanic('sets', slot.subSet);
          if (slot.mainEcho) await DataLoader.loadMechanic('echoes', slot.mainEcho);
        }
        merged.forEach(slot => { slot.echoStats = calculateEchoStatsForSlot(slot); });
        set({ team: merged });
        useRotationStore.getState().recalculate();
      },

      getIdleStats: slotIndex => {
        const team = get().team;
        const slot = team[slotIndex];
        if (!slot || !slot.character) return {};

        const activeBuffs: any[] = [];
        const mechanicsDB = DataLoader.mechanicsDB;

        const applyBuffsFromSource = (sourceName: string, isSelf: boolean) => {
          if (!sourceName) return;
          Object.keys(mechanicsDB)
            .filter(k => k.startsWith(sourceName))
            .forEach(mechId => {
              const mech = mechanicsDB[mechId];
              const hasNoRule = !mech.triggerRule || mech.triggerRule.trim() === '';
              const isAlways =
                (!hasNoRule && mech.triggerRule!.trim().startsWith('ALWAYS')) ||
                (hasNoRule && mech.isPassive);

              if (isAlways && mech.effects) {
                mech.effects.forEach(eff => {
                  if (eff.type === 'buff' && eff.stat) {
                    const appliesToSelf =
                      (eff.target === '@Self' || eff.target === '@Equipper') && isSelf;
                    const appliesToTeam = eff.target === '@Team';
                    const appliesToOthers = eff.target === '@TeamOthers' && !isSelf;
                    if (appliesToSelf || appliesToTeam || appliesToOthers) {
                      activeBuffs.push({
                        stat: eff.stat,
                        value: eff.value,
                        stacks: eff.maxStacks || 1
                      });
                    }
                  }
                });
              }
            });
        };

        const applyWeaponBuffs = (sourceName: string, isSelf: boolean, rank: number) => {
          if (!sourceName) return;
          const rIdx = Math.max(0, (rank || 1) - 1);
          Object.keys(mechanicsDB)
            .filter(k => k.startsWith(sourceName))
            .forEach(mechId => {
              const mech = mechanicsDB[mechId];
              const hasNoRule = !mech.triggerRule || mech.triggerRule.trim() === '';
              const isAlways =
                (!hasNoRule && mech.triggerRule!.trim().startsWith('ALWAYS')) ||
                (hasNoRule && mech.isPassive);

              if (isAlways && mech.effects) {
                mech.effects.forEach(eff => {
                  if (eff.type === 'buff' && eff.stat) {
                    const appliesToSelf =
                      (eff.target === '@Self' || eff.target === '@Equipper') && isSelf;
                    const appliesToTeam = eff.target === '@Team';
                    const appliesToOthers = eff.target === '@TeamOthers' && !isSelf;
                    if (appliesToSelf || appliesToTeam || appliesToOthers) {
                      let finalVal = eff.value;
                      if (typeof finalVal === 'string' && finalVal.includes('/')) {
                        const hasPercent = finalVal.includes('%');
                        const p = finalVal.split('/');
                        finalVal = p[Math.min(rIdx, p.length - 1)].trim();
                        if (hasPercent && !finalVal.includes('%')) finalVal += '%';
                      }
                      activeBuffs.push({
                        stat: eff.stat,
                        value: finalVal,
                        stacks: eff.maxStacks || 1
                      });
                    }
                  }
                });
              }
            });
        };

        team.forEach((tSlot, tIndex) => {
          if (tIndex !== slotIndex && tSlot.character) {
            applyBuffsFromSource(tSlot.character, false);
            applyWeaponBuffs(tSlot.weapon, false, tSlot.rank);
            applyBuffsFromSource(tSlot.mainSet, false);
            applyBuffsFromSource(tSlot.subSet, false);
            applyBuffsFromSource(tSlot.mainEcho, false);
          }
        });

        applyBuffsFromSource(slot.character, true);
        applyWeaponBuffs(slot.weapon, true, slot.rank);
        applyBuffsFromSource(slot.mainSet, true);
        applyBuffsFromSource(slot.subSet, true);
        applyBuffsFromSource(slot.mainEcho, true);
        applyBuffsFromSource('System', true);

        return CombatCalculator.calculateFinalStats(slot.character, activeBuffs, team);
      }
    }),
    {
      name: 'wuwa_calc_team_cache',
      onRehydrateStorage: () => {
        return (state, error) => {
          if (!error && state) {
            state.team.forEach(async slot => {
              if (slot.character) await DataLoader.loadMechanic('characters', slot.character);
              if (slot.weapon) await DataLoader.loadMechanic('weapons', slot.weapon);
              if (slot.mainSet) await DataLoader.loadMechanic('sets', slot.mainSet);
              if (slot.subSet) await DataLoader.loadMechanic('sets', slot.subSet);
              if (slot.mainEcho) await DataLoader.loadMechanic('echoes', slot.mainEcho);
            });
          }
        };
      }
    }
  )
);