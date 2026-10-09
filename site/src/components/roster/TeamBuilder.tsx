import React, { useRef, useState } from 'react';
import { useRosterStore, isUnitFile } from '../../store/useRosterStore';
import { CharacterSlot } from './CharacterSlot';
import { IdleStats } from './IdleStats';
import { TeamPreview } from '../common/TeamPreview';
import { CollapsibleSection } from '../common/CollapsibleSection';
import { CommonUtils, tip } from '../../utils/Common';
import { RosterPickDialog } from './RosterPickDialog';
import type { RosterPick } from './RosterPickDialog';

interface TeamBuilderProps {
  isOpen: boolean;
  onToggle: () => void;
}

/** Step 1: the team roster, with team import and team / single-unit export. */
export const TeamBuilder: React.FC<TeamBuilderProps> = ({ isOpen, onToggle }) => {
  const { team, importTeam } = useRosterStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const exportPick = (pick: RosterPick) => {
    setExportOpen(false);
    if (pick === 'team') CommonUtils.downloadJson(team, CommonUtils.exportFilename('Team', team));
    else CommonUtils.downloadJson(team[pick], CommonUtils.exportFilename('Unit', [team[pick]]));
  };

  // Nothing to pick between on an empty roster: the (empty) team exports straight away.
  const handleExport = () => {
    if (team.some(slot => slot.character)) setExportOpen(true);
    else exportPick('team');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = '';

    try {
      const data = JSON.parse(await CommonUtils.readTextFile(file));
      // Accepts a plain team export (array) or a rotation export (team nested under .team).
      const teamData = Array.isArray(data) ? data : Array.isArray(data?.team) ? data.team : null;
      if (teamData) {
        await importTeam(teamData);
        if (!isOpen) onToggle();
      } else if (isUnitFile(data)) {
        alert('This is a single unit file. Use a slot\'s Import Unit button instead.');
      } else {
        alert('No team data found in this file.');
      }
    } catch (err) {
      console.error('[TeamBuilder] Error importing team:', err);
      alert('Error loading team.');
    }
  };

  return (
    <CollapsibleSection
      isOpen={isOpen}
      onToggle={onToggle}
      title="Step 1: Build Team"
      ids={{ wrapper: 'step1-wrapper', header: 'team-header', content: 'team-content' }}
      overlays={exportOpen && (
        <RosterPickDialog
          title="Export"
          message="Export the full team, or a single unit."
          team={team}
          offerTeam
          onPick={exportPick}
          onCancel={() => setExportOpen(false)}
        />
      )}
      headerExtra={
        <div id="header-team-preview" className={`header-preview ${isOpen ? '' : 'is-visible'}`}>
          <TeamPreview team={team} />
        </div>
      }
      headerRight={
        <>
          <input type="file" ref={fileInputRef} accept=".json" style={{ display: 'none' }} onChange={handleImport} />
          <button className="base-btn" onClick={() => fileInputRef.current?.click()} {...tip('A team or rotation file')}>
            Import Team
          </button>
          <button className="base-btn" onClick={handleExport} {...tip('The full team or a single unit')}>
            Export Team
          </button>
        </>
      }
    >
      <div id="team-roster" className="team-container">
        {[0, 1, 2].map(index => (
          <CharacterSlot key={index} index={index} />
        ))}
      </div>
      <IdleStats />
    </CollapsibleSection>
  );
};
