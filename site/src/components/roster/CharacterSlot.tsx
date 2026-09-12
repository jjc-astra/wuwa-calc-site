// src/components/roster/CharacterSlot.tsx
import React, { useState, useEffect } from 'react';
import { useRosterStore } from '../../store/useRosterStore';
import { useBuilderStore } from '../../store/useBuilderStore';
import { DataLoader, type ImplementedContentKind } from '../../utils/DataLoader';
import { CommonUtils, TRANSPARENT_PIXEL, getCharacterThemeColor, tip } from '../../utils/Common';
import { SET_LAYOUTS, IMAGE_FOLDERS } from '../../data/db';
import type { ImageFolder } from '../../data/db';
import { EchoCard } from './EchoCard';
import { IconSelect } from '../common/IconSelect';
import { Dropdown } from '../common/Dropdown';

interface CharacterSlotProps {
  index: number;
}

const NOT_IMPLEMENTED_TIP = 'Not yet implemented';

export const CharacterSlot: React.FC<CharacterSlotProps> = ({ index }) => {
  const { team, setSlotField, applyRecommendedBuild } = useRosterStore();
  const { hasChanges: hasBuilderChanges, editedBaseStats } = useBuilderStore();
  const slot = team[index];
  // A mechanic added through the Builder makes an otherwise-unimplemented entity selectable too.
  const isSelectable = (kind: ImplementedContentKind, name: string) =>
    DataLoader.isContentImplemented(kind, name) || hasBuilderChanges(name);

  const [imgErrors, setImgErrors] = useState({ char: false, wep: false, mainSet: false, subSet: false, subSet2a: false, subSet2b: false, mainEcho: false });
  // A cache hit (e.g. this icon was already on screen before a remount) skips the fade-in --
  // only a genuinely new image needs onLoad to reveal it.
  const [imgLoaded, setImgLoaded] = useState(() => ({
    char: CommonUtils.isImageCached(CommonUtils.getIconPath(slot.character, IMAGE_FOLDERS.CHARACTERS)),
    wep: CommonUtils.isImageCached(CommonUtils.getIconPath(slot.weapon, IMAGE_FOLDERS.WEAPONS)),
    mainSet: CommonUtils.isImageCached(CommonUtils.getIconPath(slot.mainSet, IMAGE_FOLDERS.ECHO_SETS)),
    subSet: CommonUtils.isImageCached(CommonUtils.getIconPath(slot.subSet, IMAGE_FOLDERS.ECHO_SETS)),
    subSet2a: CommonUtils.isImageCached(CommonUtils.getIconPath(slot.subSet2a, IMAGE_FOLDERS.ECHO_SETS)),
    subSet2b: CommonUtils.isImageCached(CommonUtils.getIconPath(slot.subSet2b, IMAGE_FOLDERS.ECHO_SETS)),
    mainEcho: CommonUtils.isImageCached(CommonUtils.getIconPath(slot.mainEcho, IMAGE_FOLDERS.ECHOES))
  }));

  useEffect(() => {
    setImgErrors(p => ({ ...p, char: false }));
    setImgLoaded(p => ({ ...p, char: CommonUtils.isImageCached(CommonUtils.getIconPath(slot.character, IMAGE_FOLDERS.CHARACTERS)) }));
  }, [slot.character]);
  useEffect(() => {
    setImgErrors(p => ({ ...p, wep: false }));
    setImgLoaded(p => ({ ...p, wep: CommonUtils.isImageCached(CommonUtils.getIconPath(slot.weapon, IMAGE_FOLDERS.WEAPONS)) }));
  }, [slot.weapon]);
  useEffect(() => {
    setImgErrors(p => ({ ...p, mainSet: false }));
    setImgLoaded(p => ({ ...p, mainSet: CommonUtils.isImageCached(CommonUtils.getIconPath(slot.mainSet, IMAGE_FOLDERS.ECHO_SETS)) }));
  }, [slot.mainSet]);
  useEffect(() => {
    setImgErrors(p => ({ ...p, subSet: false }));
    setImgLoaded(p => ({ ...p, subSet: CommonUtils.isImageCached(CommonUtils.getIconPath(slot.subSet, IMAGE_FOLDERS.ECHO_SETS)) }));
  }, [slot.subSet]);
  useEffect(() => {
    setImgErrors(p => ({ ...p, subSet2a: false }));
    setImgLoaded(p => ({ ...p, subSet2a: CommonUtils.isImageCached(CommonUtils.getIconPath(slot.subSet2a, IMAGE_FOLDERS.ECHO_SETS)) }));
  }, [slot.subSet2a]);
  useEffect(() => {
    setImgErrors(p => ({ ...p, subSet2b: false }));
    setImgLoaded(p => ({ ...p, subSet2b: CommonUtils.isImageCached(CommonUtils.getIconPath(slot.subSet2b, IMAGE_FOLDERS.ECHO_SETS)) }));
  }, [slot.subSet2b]);
  useEffect(() => {
    setImgErrors(p => ({ ...p, mainEcho: false }));
    setImgLoaded(p => ({ ...p, mainEcho: CommonUtils.isImageCached(CommonUtils.getIconPath(slot.mainEcho, IMAGE_FOLDERS.ECHOES)) }));
  }, [slot.mainEcho]);

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

  let allowedEchoes: string[] = [];
  if (slot.mainSet) {
    if (DataLoader.setEchoMapping[slot.mainSet]) allowedEchoes.push(...DataLoader.setEchoMapping[slot.mainSet]);
    if (isThreePcSet && slot.subSet && DataLoader.setEchoMapping[slot.subSet]) {
      allowedEchoes.push(...DataLoader.setEchoMapping[slot.subSet]);
    }
    allowedEchoes = Array.from(new Set(allowedEchoes));
    if (allowedEchoes.length === 0) allowedEchoes = DataLoader.allMainEchoes;
  }

  const renderAvatar = (
    type: 'char' | 'wep' | 'mainSet' | 'subSet' | 'subSet2a' | 'subSet2b' | 'mainEcho',
    val: string,
    folder: ImageFolder,
    avatarClass: string
  ) => {
    const hasVal = !!val;
    const path = hasVal ? CommonUtils.getIconPath(val, folder) : TRANSPARENT_PIXEL;
    const hasError = imgErrors[type];
    const isLoaded = imgLoaded[type];
    const showImage = hasVal && !hasError && isLoaded;

    return (
      <div className={`avatar ${avatarClass} avatar-wrapper`}>
        <span className={showImage ? 'opacity-0' : ''}>
          {hasVal ? val.charAt(0) : '?'}
        </span>
        <img
          className={`avatar-img ${showImage ? 'opacity-1' : 'opacity-0'}`}
          src={path}
          alt={val || 'empty'}
          onLoad={() => { if (hasVal) setImgLoaded(p => ({ ...p, [type]: true })); }}
          onError={() => { if (hasVal) setImgErrors(p => ({ ...p, [type]: true })); }}
        />
      </div>
    );
  };

  return (
    <div className={`char-row ${hasMode ? 'has-mode' : ''}`} style={{ '--char-theme-raw': themeColor } as React.CSSProperties}>
      {/* 1. Character Column */}
      <div className="panel-col" style={{ position: 'relative' }}>
        <button
          type="button"
          className="base-btn icon-btn quick-build-btn"
          {...tip('Load Recommended Build')}
          style={{ position: 'absolute', top: '0px', left: '5px', zIndex: 10 }}
          onClick={(e) => {
            e.preventDefault();
            if (slot.character) applyRecommendedBuild(index, slot.character);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </button>

        {renderAvatar('char', slot.character, IMAGE_FOLDERS.CHARACTERS, 'avatar-lg avatar-circle mb-sm')}

        <div className="flex-col gap-sm" style={{ marginTop: 'auto' }}>
          <IconSelect
            className={`base-select char-select text-bold ${slot.character ? 'has-value' : ''}`}
            value={slot.character || ''}
            onChange={v => setSlotField(index, 'character', v)}
            iconFolder={IMAGE_FOLDERS.CHARACTERS}
            iconShape="circle"
            placeholder="Character"
            searchable
            options={DataLoader.charList.map(c => ({ value: c, disabled: !isSelectable('character', c), disabledTooltip: NOT_IMPLEMENTED_TIP }))}
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
        {renderAvatar('wep', slot.weapon, IMAGE_FOLDERS.WEAPONS, 'avatar-lg avatar-rect mb-sm')}
        <div className="flex-col gap-sm" style={{ marginTop: 'auto' }}>
          <IconSelect
            className={`base-select wep-select text-bold ${slot.weapon ? 'has-value' : ''}`}
            value={slot.weapon || ''}
            disabled={!slot.character}
            onChange={v => setSlotField(index, 'weapon', v)}
            iconFolder={IMAGE_FOLDERS.WEAPONS}
            iconShape="rect"
            placeholder={slot.character ? 'Weapon' : 'Select Character First'}
            options={validWeapons.map(w => ({ value: w, disabled: !isSelectable('weapon', w), disabledTooltip: NOT_IMPLEMENTED_TIP }))}
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
          <div className="flex-row gap-sm">
            {renderAvatar('mainSet', slot.mainSet, IMAGE_FOLDERS.ECHO_SETS, 'avatar-sm')}
            <IconSelect
              className={`base-select main-set-select ${slot.mainSet ? 'has-value' : ''}`}
              value={slot.mainSet || ''}
              onChange={v => setSlotField(index, 'mainSet', v)}
              iconFolder={IMAGE_FOLDERS.ECHO_SETS}
              iconShape="circle"
              placeholder="Main Set"
              options={DataLoader.sonataSets.map(s => ({ value: s, disabled: !isSelectable('set', s), disabledTooltip: NOT_IMPLEMENTED_TIP }))}
            />
          </div>
          {isThreePcSet && (
            <div className="flex-row gap-sm sub-set-row">
              {renderAvatar('subSet', slot.subSet, IMAGE_FOLDERS.ECHO_SETS, 'avatar-sm')}
              <IconSelect
                className={`base-select sub-set-select ${slot.subSet ? 'has-value' : ''}`}
                value={slot.subSet || ''}
                onChange={v => setSlotField(index, 'subSet', v)}
                iconFolder={IMAGE_FOLDERS.ECHO_SETS}
                iconShape="circle"
                placeholder="Sub Set"
                options={DataLoader.sonataSets.map(s => ({ value: s, disabled: !isSelectable('set', s), disabledTooltip: NOT_IMPLEMENTED_TIP }))}
              />
            </div>
          )}
          {isOnePcSet && (
            <>
              <div className="flex-row gap-sm sub-set-row">
                {renderAvatar('subSet2a', slot.subSet2a, IMAGE_FOLDERS.ECHO_SETS, 'avatar-sm')}
                <IconSelect
                  className={`base-select sub-set-select ${slot.subSet2a ? 'has-value' : ''}`}
                  value={slot.subSet2a || ''}
                  onChange={v => setSlotField(index, 'subSet2a', v)}
                  iconFolder={IMAGE_FOLDERS.ECHO_SETS}
                  iconShape="circle"
                  placeholder="Extra Set A"
                  options={DataLoader.sonataSets.map(s => ({ value: s, disabled: !isSelectable('set', s), disabledTooltip: NOT_IMPLEMENTED_TIP }))}
                />
              </div>
              <div className="flex-row gap-sm sub-set-row">
                {renderAvatar('subSet2b', slot.subSet2b, IMAGE_FOLDERS.ECHO_SETS, 'avatar-sm')}
                <IconSelect
                  className={`base-select sub-set-select ${slot.subSet2b ? 'has-value' : ''}`}
                  value={slot.subSet2b || ''}
                  onChange={v => setSlotField(index, 'subSet2b', v)}
                  iconFolder={IMAGE_FOLDERS.ECHO_SETS}
                  iconShape="circle"
                  placeholder="Extra Set B"
                  options={DataLoader.sonataSets.map(s => ({ value: s, disabled: !isSelectable('set', s), disabledTooltip: NOT_IMPLEMENTED_TIP }))}
                />
              </div>
            </>
          )}
          {slot.mainSet && !isOnePcSet && (
            <div className="flex-row gap-sm main-echo-row">
              {renderAvatar('mainEcho', slot.mainEcho, IMAGE_FOLDERS.ECHOES, 'avatar-sm')}
              <IconSelect
                className={`base-select main-echo-select ${slot.mainEcho ? 'has-value' : ''}`}
                value={slot.mainEcho || ''}
                onChange={v => setSlotField(index, 'mainEcho', v)}
                iconFolder={IMAGE_FOLDERS.ECHOES}
                iconShape="circle"
                placeholder="Main Echo"
                options={allowedEchoes.map(e => ({ value: e, disabled: !isSelectable('echo', e), disabledTooltip: NOT_IMPLEMENTED_TIP }))}
              />
            </div>
          )}
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