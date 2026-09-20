// src/components/roster/TeamBuilder.tsx
import React, { useRef } from 'react';
import { useRosterStore } from '../../store/useRosterStore';
import { CharacterSlot } from './CharacterSlot';
import { IdleStats } from './IdleStats';
import { TeamPreview } from '../common/TeamPreview';
import { CollapsibleSection } from '../common/CollapsibleSection';
import { CommonUtils } from '../../utils/Common';
import { serializableTeam } from '../../utils/TeamUtils';

interface TeamBuilderProps {
  isOpen: boolean;
  onToggle: () => void;
}

export const TeamBuilder: React.FC<TeamBuilderProps> = ({ isOpen, onToggle }) => {
  const { team, importTeam } = useRosterStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const dataToExport = serializableTeam(team);
    CommonUtils.downloadJson(dataToExport, CommonUtils.exportFilename('Team', dataToExport));
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
      headerExtra={
        <div id="header-team-preview" className={`header-preview ${isOpen ? '' : 'is-visible'}`}>
          <TeamPreview team={team} />
        </div>
      }
      headerRight={
        <>
          <input type="file" ref={fileInputRef} accept=".json" style={{ display: 'none' }} onChange={handleImport} />
          <button className="base-btn" onClick={() => fileInputRef.current?.click()}>
            Import Team
          </button>
          <button className="base-btn" onClick={handleExport}>
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
