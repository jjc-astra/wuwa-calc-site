import React from 'react';
import { useRosterStore } from '../../store/useRosterStore';
import { STAT_DB, costsForLayout, mainStatOptionsFor } from '../../data/db';
import { Dropdown } from '../common/Dropdown';

interface EchoCardProps {
  slotIndex: number;
  echoIndex: number;
}

export const EchoCard: React.FC<EchoCardProps> = ({ slotIndex, echoIndex }) => {
  const { team, setSlotField, setSubstat } = useRosterStore();
  const slot = team[slotIndex];
  const echo = slot.echoes[echoIndex];

  const cost = costsForLayout(slot.layout)[echoIndex];
  const mainStatOptions = mainStatOptionsFor(cost);
  const statKeys = Object.keys(STAT_DB);

  const handleMainStatChange = (value: string) => {
    const newEchoes = [...slot.echoes];
    newEchoes[echoIndex] = { ...newEchoes[echoIndex], mainStat: value };
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
        <Dropdown
          className={`base-select echo-main-stat-select ${echo.mainStat ? 'has-value' : ''}`}
          value={echo.mainStat || ''}
          onChange={handleMainStatChange}
          placeholder={`Echo ${echoIndex + 1} (Cost ${cost})`}
          options={mainStatOptions.map(opt => ({ value: opt, label: opt }))}
        />
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
              <Dropdown
                className={`base-select stat-select ${!isNA ? 'has-value' : ''}`}
                value={sub.name || 'N/A'}
                onChange={v => handleSubstatNameChange(subIdx, v)}
                options={[{ value: 'N/A', label: 'N/A' }, ...statKeys.map(k => ({ value: k, label: k }))]}
              />
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