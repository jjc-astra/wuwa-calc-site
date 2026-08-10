import React from 'react';
import { useRosterStore } from '../../store/useRosterStore';
import { MAIN_STATS_4_COST, MAIN_STATS_3_COST, MAIN_STATS_1_COST, STAT_DB, COST_DISTRIBUTION } from '../../data/db';

interface EchoCardProps {
  slotIndex: number;
  echoIndex: number;
}

export const EchoCard: React.FC<EchoCardProps> = ({ slotIndex, echoIndex }) => {
  const { team, setSlotField, setSubstat } = useRosterStore();
  const slot = team[slotIndex];
  const echo = slot.echoes[echoIndex];

  const costs = COST_DISTRIBUTION[slot.layout || '4 3 3 1 1'] || [4, 3, 3, 1, 1];
  const cost = costs[echoIndex];
  const mainStatOptions = cost === 4 ? MAIN_STATS_4_COST : cost === 3 ? MAIN_STATS_3_COST : MAIN_STATS_1_COST;
  const statKeys = Object.keys(STAT_DB);

  const handleMainStatChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newEchoes = [...slot.echoes];
    newEchoes[echoIndex] = { ...newEchoes[echoIndex], mainStat: e.target.value };
    setSlotField(slotIndex, 'echoes', newEchoes);
  };

  const handleSubstatNameChange = (subIndex: number, newName: string) => {
    let newVal: string | number = '';
    if (newName !== 'N/A' && STAT_DB[newName]) {
      const entry = STAT_DB[newName];
      newVal = entry.values[entry.defaultIndex !== undefined ? entry.defaultIndex : 0];
    }
    setSubstat(slotIndex, echoIndex, subIndex, newName, newVal);
  };

  const handleSliderChange = (subIndex: number, sliderIdx: number) => {
    const name = echo.substats[subIndex].name;
    if (name === 'N/A' || !STAT_DB[name]) return;
    const val = STAT_DB[name].values[sliderIdx];
    setSubstat(slotIndex, echoIndex, subIndex, name, val);
  };

  return (
    <div className="base-card echo-card-wrap" data-echo-index={echoIndex}>
      <div className="echo-header">
        <select
          className={`base-select echo-main-stat-select ${echo.mainStat ? 'has-value' : ''}`}
          value={echo.mainStat || ''}
          onChange={handleMainStatChange}
        >
          <option value="" disabled hidden>Echo {echoIndex + 1} (Cost {cost})</option>
          {mainStatOptions.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
      <ul className="echo-list">
        {echo.substats.map((sub, subIdx) => {
          const isNA = sub.name === 'N/A' || !sub.name;
          const statData = STAT_DB[sub.name];
          const maxSlider = statData ? statData.values.length - 1 : 0;
          let currentSliderVal = 0;
          if (statData) {
            const parsedVal = parseFloat(String(sub.value));
            const idx = statData.values.indexOf(parsedVal);
            currentSliderVal = idx > -1 ? idx : (statData.defaultIndex || 0);
          }

          return (
            <li key={subIdx} className="stat-row">
              <select
                className={`base-select stat-select ${!isNA ? 'has-value' : ''}`}
                value={sub.name || 'N/A'}
                onChange={e => handleSubstatNameChange(subIdx, e.target.value)}
              >
                <option value="N/A">N/A</option>
                {statKeys.map(k => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
              <input
                type="range"
                className={`base-slider ${isNA ? 'opacity-0' : ''}`}
                min="0"
                max={maxSlider}
                step="1"
                value={Math.max(0, currentSliderVal)}
                disabled={isNA}
                onChange={e => handleSliderChange(subIdx, parseInt(e.target.value, 10))}
              />
              <div className="base-num-box stat-num-box">
                <input
                  type="text"
                  className="num-input stat-value"
                  value={sub.value || ''}
                  readOnly
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};