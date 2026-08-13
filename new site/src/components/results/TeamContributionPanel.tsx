// src/components/results/TeamContributionPanel.tsx
import React, { useMemo, useState } from 'react';
import { useRosterStore } from '../../store/useRosterStore';
import { DataLoader } from '../../utils/DataLoader';
import { generateMockTeamContribution, generateMockUnitContribution } from '../../data/mockResults';
import { PieChart } from './PieChart';
import { colorForIndex, OTHER_SLICE_COLOR } from './chartPalette';
import { getCharacterThemeColor } from '../../utils/Common';

export const TeamContributionPanel: React.FC = () => {
  const team = useRosterStore(s => s.team);
  const units = team.filter(s => s.character).map(s => s.character);
  const tabs = ['Team', ...units];
  const [activeTab, setActiveTab] = useState('Team');
  const tab = tabs.includes(activeTab) ? activeTab : 'Team';

  const teamSlices = useMemo(() => generateMockTeamContribution(units), [units.join(',')]);
  const unitSlices = useMemo(() => (tab !== 'Team' ? generateMockUnitContribution(tab) : []), [tab]);

  const data =
    tab === 'Team'
      ? teamSlices.map((s, i) => {
          // The first `units.length` slices are the team's own units, in the same order --
          // theme each by its own character color instead of the generic categorical palette.
          if (i < units.length) {
            const themeColor = getCharacterThemeColor(DataLoader.characterDB[s.label]);
            return { label: s.label, value: s.dmg, color: themeColor, labelColor: themeColor };
          }
          return { label: s.label, value: s.dmg, color: colorForIndex(i - units.length) };
        })
      : unitSlices.map((s, i) => ({
          label: s.castType,
          value: s.dmg,
          color: s.castType === 'Other' ? OTHER_SLICE_COLOR : colorForIndex(i)
        }));

  return (
    <div className="results-card">
      <div className="results-card-header">
        <span>Team DMG Contribution</span>
      </div>
      {units.length === 0 ? (
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
          <PieChart data={data} totalLabel={tab === 'Team' ? 'Team DMG' : `${tab} DMG`} />
        </>
      )}
    </div>
  );
};
