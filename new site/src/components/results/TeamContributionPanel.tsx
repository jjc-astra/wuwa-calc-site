// src/components/results/TeamContributionPanel.tsx
import React, { useMemo, useState } from 'react';
import { useRosterStore } from '../../store/useRosterStore';
import { useRotationStore } from '../../store/useRotationStore';
import { DataLoader } from '../../utils/DataLoader';
import type { DpsWindowKey } from '../../types/results';
import { PieChart } from './PieChart';
import { colorForLabel, OTHER_SLICE_COLOR } from './chartPalette';
import { getCharacterThemeColor } from '../../utils/Common';
import { Dropdown } from '../common/Dropdown';

const DPS_TYPE_OPTIONS: Array<{ key: DpsWindowKey; label: string }> = [
  { key: 'opener', label: 'Opener' },
  { key: 'firstLoop', label: 'First Loop' },
  { key: 'avgLoop', label: 'Avg Loop' },
  { key: 'twoMin', label: '2-Min' }
];

export const TeamContributionPanel: React.FC = () => {
  const team = useRosterStore(s => s.team);
  const results = useRotationStore(s => s.results);
  const units = team.filter(s => s.character).map(s => s.character);
  const tabs = ['Team', ...units];
  const [activeTab, setActiveTab] = useState('Team');
  const [dpsType, setDpsType] = useState<DpsWindowKey>('twoMin');
  const tab = tabs.includes(activeTab) ? activeTab : 'Team';

  const forWindow = results?.contribution[dpsType];
  const teamSlices = useMemo(() => forWindow?.team ?? [], [forWindow]);
  const unitSlices = useMemo(() => (tab !== 'Team' ? forWindow?.units[tab] ?? [] : []), [forWindow, tab]);

  const data =
    tab === 'Team'
      ? teamSlices.map(s => {
          // Status/mechanic slices (e.g. Aero Erosion) aren't a team unit -- fall through to
          // the generic categorical palette for those instead of a character theme color.
          if (units.includes(s.label)) {
            const themeColor = getCharacterThemeColor(DataLoader.characterDB[s.label]);
            return { label: s.label, value: s.dmg, color: themeColor, labelColor: themeColor };
          }
          return { label: s.label, value: s.dmg, color: colorForLabel(s.label) };
        })
      : unitSlices.map(s => ({
          label: s.castType,
          value: s.dmg,
          color: s.castType === 'Other' ? OTHER_SLICE_COLOR : colorForLabel(s.castType)
        }));

  return (
    <div className="results-card">
      <div className="results-card-header">
        <span>DMG Contribution</span>
        <Dropdown
          className="base-select text-xs results-dps-type-select"
          value={dpsType}
          onChange={v => setDpsType(v as DpsWindowKey)}
          options={DPS_TYPE_OPTIONS.map(opt => ({ value: opt.key, label: opt.label }))}
        />
      </div>
      {!results || units.length === 0 ? (
        <div className="results-empty">Add characters to the team to see contribution.</div>
      ) : (
        <>
          <div className="unit-tabs">
            {tabs.map(t => (
              <button
                key={t}
                type="button"
                className={`unit-tab ${t === tab ? 'is-active' : ''}`}
                style={t === 'Team' ? undefined : ({ '--unit-theme': getCharacterThemeColor(DataLoader.characterDB[t]) } as React.CSSProperties)}
                onClick={() => setActiveTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {data.length === 0 ? (
            <div className="results-empty">No damage in this window.</div>
          ) : (
            <PieChart data={data} totalLabel={tab === 'Team' ? 'Team DMG' : `${tab} DMG`} />
          )}
        </>
      )}
    </div>
  );
};
