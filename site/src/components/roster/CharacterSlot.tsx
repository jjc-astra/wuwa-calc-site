import React from 'react';
import { useRosterStore } from '../../store/useRosterStore';
import { useBuilderStore } from '../../store/useBuilderStore';
import { DataLoader } from '../../utils/DataLoader';
import { selectableOptions } from '../../utils/selectableContent';
import { CommonUtils, getCharacterThemeColor, tip } from '../../utils/Common';
import { SET_LAYOUTS, IMAGE_FOLDERS } from '../../data/db';
import type { ImageFolder } from '../../data/db';
import { EchoCard } from './EchoCard';
import { AvatarIcon } from '../common/AvatarIcon';
import { IconSelect } from '../common/IconSelect';
import type { IconSelectOption } from '../common/IconSelect';
import { Dropdown } from '../common/Dropdown';

interface CharacterSlotProps {
  index: number;
}

/** One roster slot: character, weapon, echo sets and echoes. */
export const CharacterSlot: React.FC<CharacterSlotProps> = ({ index }) => {
  const { team, setSlotField, applyRecommendedBuild, clearSlot } = useRosterStore();
  // Subscribed (not just read) so Builder edits -- which can make an entity selectable -- re-render the pickers.
  const { editedBaseStats } = useBuilderStore();
  const slot = team[index];

  // Builder edits only replay onto DataLoader.characterDB once opened in the Builder
  // (setActiveChar) -- so un-opened edits still need overlaying here (e.g. isDualMode).
  const charData = slot.character
    ? { ...(DataLoader.characterDB[slot.character] || {}), ...(editedBaseStats[slot.character] || {}) }
    : null;
  const validWeapons = charData ? DataLoader.weaponsByType[charData.weaponType] || [] : [];
  const hasMode = !!charData?.isDualMode;
  const mode1Label = charData?.mode1Name || 'Mode 1';
  const mode2Label = charData?.mode2Name || 'Mode 2';
  const themeColor = getCharacterThemeColor(charData || undefined);
  const isThreePcSet = DataLoader.threePcSets.includes(slot.mainSet);
  const isOnePcSet = DataLoader.onePcSets.includes(slot.mainSet);
  const allowedEchoes = DataLoader.allowedMainEchoes(slot);

  const setOptions = selectableOptions('set', DataLoader.sonataSets);

  // One "icon + select" row for a set or echo slot.
  const renderItemRow = (
    field: 'mainSet' | 'subSet' | 'subSet2a' | 'subSet2b' | 'mainEcho',
    opts: { folder: ImageFolder; placeholder: string; rowClass?: string; selectClass: string; options: IconSelectOption[] }
  ) => (
    <div className={`flex-row gap-sm${opts.rowClass ? ` ${opts.rowClass}` : ''}`}>
      <AvatarIcon name={slot[field]} folder={opts.folder} className="avatar-sm" />
      <IconSelect
        className={`base-select ${opts.selectClass} ${slot[field] ? 'has-value' : ''}`}
        value={slot[field] || ''}
        onChange={v => setSlotField(index, field, v)}
        iconFolder={opts.folder}
        iconShape="circle"
        placeholder={opts.placeholder}
        options={opts.options}
      />
    </div>
  );

  return (
    <div className={`char-row ${hasMode ? 'has-mode' : ''}`} style={{ '--char-theme-raw': themeColor } as React.CSSProperties}>
      {/* 1. Character Column */}
      <div className="panel-col" style={{ position: 'relative' }}>
        <button
          type="button"
          className="base-btn icon-btn quick-build-btn"
          {...tip('Load Recommended Build')}
          style={{ position: 'absolute', top: '0px', left: '0.3125rem', zIndex: 10 }}
          onClick={(e) => {
            e.preventDefault();
            if (slot.character) applyRecommendedBuild(index, slot.character);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </button>

        <button
          type="button"
          className="base-btn icon-btn clear-slot-btn"
          {...tip('Remove from Roster')}
          style={{ position: 'absolute', top: '0px', right: '0.3125rem', zIndex: 10 }}
          onClick={(e) => {
            e.preventDefault();
            if (slot.character) clearSlot(index);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>

        <AvatarIcon name={slot.character} folder={IMAGE_FOLDERS.CHARACTERS} className="avatar-lg avatar-circle mb-sm" />

        <div className="flex-col gap-sm" style={{ marginTop: 'auto' }}>
          <IconSelect
            className={`base-select char-select text-bold ${slot.character ? 'has-value' : ''}`}
            value={slot.character || ''}
            onChange={v => setSlotField(index, 'character', v)}
            iconFolder={IMAGE_FOLDERS.CHARACTERS}
            iconShape="circle"
            placeholder="Character"
            searchable
            options={selectableOptions('character', DataLoader.charList)}
          />
          <div className="flex-row gap-sm seq-mode-row">
            <div className="base-num-box seq-box">
              <span className="text-xs text-bold text-dim">SEQ</span>
              <input type="number" className="num-input seq-input" value={slot.sequence} min="0" max="6" onChange={e => setSlotField(index, 'sequence', CommonUtils.clampToRange(parseInt(e.target.value) || 0, 0, 6))} />
            </div>
            {hasMode && (
              <Dropdown
                className="base-select mode-select has-value"
                value={slot.mode}
                onChange={v => setSlotField(index, 'mode', v)}
                options={[
                  { value: 'None', label: 'None' },
                  { value: 'mode1', label: mode1Label },
                  { value: 'mode2', label: mode2Label }
                ]}
              />
            )}
          </div>
        </div>
      </div>

      {/* 2. Weapon Column */}
      <div className="panel-col">
        <AvatarIcon name={slot.weapon} folder={IMAGE_FOLDERS.WEAPONS} className="avatar-lg avatar-rect mb-sm" />
        <div className="flex-col gap-sm" style={{ marginTop: 'auto' }}>
          <IconSelect
            className={`base-select wep-select text-bold ${slot.weapon ? 'has-value' : ''}`}
            value={slot.weapon || ''}
            disabled={!slot.character}
            onChange={v => setSlotField(index, 'weapon', v)}
            iconFolder={IMAGE_FOLDERS.WEAPONS}
            iconShape="rect"
            placeholder={slot.character ? 'Weapon' : 'Select Character First'}
            options={selectableOptions('weapon', validWeapons)}
          />
          <div className="base-num-box">
            <span className="text-xs text-bold text-dim">RANK</span>
            <input type="number" className="num-input rank-input" value={slot.rank} min="1" max="5" onChange={e => setSlotField(index, 'rank', CommonUtils.clampToRange(parseInt(e.target.value) || 1, 1, 5))} />
          </div>
        </div>
      </div>

      {/* 3. Echo Sets Column */}
      <div className="panel-col sets-col">
        <div className="set-header">Sonata Sets</div>
        <div className="flex-col gap-sm">
          <div className="flex-row gap-sm">
            <div className="avatar avatar-sm" style={{ visibility: 'hidden' }}></div>
            <Dropdown
              className="base-select layout-select has-value"
              value={slot.layout}
              onChange={v => setSlotField(index, 'layout', v)}
              options={SET_LAYOUTS.map(l => ({ value: l, label: l }))}
            />
          </div>
          {renderItemRow('mainSet', { folder: IMAGE_FOLDERS.ECHO_SETS, placeholder: 'Main Set', selectClass: 'main-set-select', options: setOptions })}
          {isThreePcSet && renderItemRow('subSet', { folder: IMAGE_FOLDERS.ECHO_SETS, placeholder: 'Sub Set', rowClass: 'sub-set-row', selectClass: 'sub-set-select', options: setOptions })}
          {isOnePcSet && (
            <>
              {renderItemRow('subSet2a', { folder: IMAGE_FOLDERS.ECHO_SETS, placeholder: 'Extra Set A', rowClass: 'sub-set-row', selectClass: 'sub-set-select', options: setOptions })}
              {renderItemRow('subSet2b', { folder: IMAGE_FOLDERS.ECHO_SETS, placeholder: 'Extra Set B', rowClass: 'sub-set-row', selectClass: 'sub-set-select', options: setOptions })}
            </>
          )}
          {slot.mainSet && !isOnePcSet && renderItemRow('mainEcho', { folder: IMAGE_FOLDERS.ECHOES, placeholder: 'Main Echo', rowClass: 'main-echo-row', selectClass: 'main-echo-select', options: selectableOptions('echo', allowedEchoes) })}
        </div>
      </div>

      {/* 4. Echo Grid */}
      <div className="echo-container">
        {[0, 1, 2, 3, 4].map(i => (
          <EchoCard key={i} slotIndex={index} echoIndex={i} />
        ))}
      </div>
    </div>
  );
};