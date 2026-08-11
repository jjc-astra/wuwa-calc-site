// src/components/roster/TeamBuilder.tsx
import React, { useRef, useState } from 'react';
import { useRosterStore } from '../../store/useRosterStore';
import { CommonUtils } from '../../utils/Common';
import { CharacterSlot } from './CharacterSlot';
import { IdleStats } from './IdleStats';
import { useAccordionAnimDone } from '../../hooks/useAccordionAnimDone';
import { useCollapseMaxHeight } from '../../hooks/useCollapseMaxHeight';

interface TeamBuilderProps {
  isOpen: boolean;
  onToggle: () => void;
}

const PreviewIcon: React.FC<{ name: string; folder: string }> = ({ name, folder }) => {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const showImage = !errored;

  return (
    <>
      {!showImage || !loaded ? <span className="preview-char-initial">?</span> : null}
      {showImage && (
        <img
          className={`preview-img-abs ${loaded ? 'opacity-1' : 'opacity-0'}`}
          src={CommonUtils.getIconPath(name, folder)}
          alt={name}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
        />
      )}
    </>
  );
};

export const TeamBuilder: React.FC<TeamBuilderProps> = ({ isOpen, onToggle }) => {
  const isCollapsed = !isOpen;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const animDone = useAccordionAnimDone(isOpen, wrapperRef);
  const contentRef = useRef<HTMLDivElement>(null);
  const maxHeight = useCollapseMaxHeight(isOpen, contentRef);
  const { team, importTeam } = useRosterStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const dataToExport = team.map(slot => {
      const { domRef, ...cleanData } = slot;
      return cleanData;
    });
    
    const names = dataToExport
      .filter(s => s.character)
      .map(s => {
        let id = s.character.replace(/\s+/g, '');
        if (s.weapon) {
          const initials = s.weapon.match(/\b\w/g) || [];
          id += `-${initials.join('').toUpperCase()}`;
        }
        return id;
      });

    const filename = names.length > 0 ? `Team_${names.join('_')}.json` : 'Team_Config.json';
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (Array.isArray(data)) {
          await importTeam(data);
        }
      } catch (err) {
        console.error('[TeamBuilder] Error importing team:', err);
        alert('Error loading team.');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div ref={wrapperRef} className={`section-wrapper ${isCollapsed ? 'is-collapsed' : ''} ${animDone ? 'anim-done' : ''}`} id="step1-wrapper">
      <div
        className="section-header"
        id="team-header"
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (target.classList.contains('toggle-icon')) {
            onToggle();
            return;
          }
          if (target.tagName !== 'BUTTON' && target.tagName !== 'INPUT') {
            onToggle();
          }
        }}
      >
        <div className="header-left">
			<button className={`toggle-icon ${isCollapsed ? 'collapsed' : ''}`}>▼</button>
			<h2 className="section-title">Step 1: Build Team</h2>
			<div id="header-team-preview" className={`header-preview ${isCollapsed ? 'is-visible' : ''}`}>
            {team.map((slot, i) => (
              <div key={i} className="preview-slot">
                <div className="preview-avatar preview-circle preview-avatar-wrap" title={slot.character || 'No Character'}>
                  {slot.character ? (
                    <PreviewIcon name={slot.character} folder="characters" />
                  ) : (
                    <span className="preview-char-initial">?</span>
                  )}
                </div>
                <span className="preview-badge">S{slot.sequence || 0}</span>
                <span style={{ color: '#555', margin: '0 5px' }}>/</span>
                <div className="preview-avatar preview-rect preview-avatar-wrap" title={slot.weapon || 'No Weapon'}>
                  {slot.weapon ? (
                    <PreviewIcon name={slot.weapon} folder="weapons" />
                  ) : (
                    <span className="preview-char-initial">?</span>
                  )}
                </div>
                <span className="preview-badge">R{slot.rank || 1}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="header-right">
          <input type="file" ref={fileInputRef} accept=".json" style={{ display: 'none' }} onChange={handleImport} />
          <button className="base-btn" onClick={() => fileInputRef.current?.click()}>
            Import Team
          </button>
          <button className="base-btn" onClick={handleExport}>
            Export Team
          </button>
        </div>
      </div>
      <div
        id="team-content"
        ref={contentRef}
        className="collapsible-content"
        style={{ maxHeight }}
        aria-hidden={isCollapsed}
      >
        <div id="team-roster" className="team-container">
          {[0, 1, 2].map(index => (
            <CharacterSlot key={index} index={index} />
          ))}
        </div>
        <IdleStats />
      </div>
    </div>
  );
};