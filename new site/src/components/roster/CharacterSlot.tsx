// src/components/roster/CharacterSlot.tsx
import React, { useState, useEffect } from 'react';
import { useRosterStore } from '../../store/useRosterStore';
import { DataLoader } from '../../utils/DataLoader';
import { CommonUtils, TRANSPARENT_PIXEL } from '../../utils/Common';
import { CHARS_WITH_MODES, SET_LAYOUTS, IMAGE_FOLDERS, isContentImplemented } from '../../data/db';
import type { ImageFolder } from '../../data/db';
import { EchoCard } from './EchoCard';

interface CharacterSlotProps {
  index: number;
}

export const CharacterSlot: React.FC<CharacterSlotProps> = ({ index }) => {
  const { team, setSlotField, applyRecommendedBuild } = useRosterStore();
  const slot = team[index];

  const [imgErrors, setImgErrors] = useState({ char: false, wep: false, mainSet: false, subSet: false, mainEcho: false });
  const [imgLoaded, setImgLoaded] = useState({ char: false, wep: false, mainSet: false, subSet: false, mainEcho: false });

  useEffect(() => { setImgErrors(p => ({ ...p, char: false })); setImgLoaded(p => ({ ...p, char: false })); }, [slot.character]);
  useEffect(() => { setImgErrors(p => ({ ...p, wep: false })); setImgLoaded(p => ({ ...p, wep: false })); }, [slot.weapon]);
  useEffect(() => { setImgErrors(p => ({ ...p, mainSet: false })); setImgLoaded(p => ({ ...p, mainSet: false })); }, [slot.mainSet]);
  useEffect(() => { setImgErrors(p => ({ ...p, subSet: false })); setImgLoaded(p => ({ ...p, subSet: false })); }, [slot.subSet]);
  useEffect(() => { setImgErrors(p => ({ ...p, mainEcho: false })); setImgLoaded(p => ({ ...p, mainEcho: false })); }, [slot.mainEcho]);

  const charData = DataLoader.characterDB[slot.character] || null;
  const validWeapons = charData ? DataLoader.weaponsByType[charData.weaponType] || [] : [];
  const hasMode = CHARS_WITH_MODES.includes(slot.character);
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

  const renderAvatar = (
    type: 'char' | 'wep' | 'mainSet' | 'subSet' | 'mainEcho',
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
    <div className={`char-row ${hasMode ? 'has-mode' : ''}`}>
      {/* 1. Character Column */}
      <div className="panel-col" style={{ position: 'relative' }}>
        <button
          type="button"
          className="base-btn icon-btn quick-build-btn"
          title="Load Recommended Build"
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
          <select className={`base-select char-select text-bold ${slot.character ? 'has-value' : ''}`} value={slot.character || ''} onChange={e => setSlotField(index, 'character', e.target.value)}>
            <option value="" disabled hidden>Character</option>
            {DataLoader.charList.map(c => <option key={c} value={c} disabled={!isContentImplemented('character', c)}>{c}</option>)}
          </select>
          <div className="flex-row gap-sm seq-mode-row">
            <div className="base-num-box seq-box">
              <span className="text-xs text-bold text-dim">SEQ</span>
              <input type="number" className="num-input seq-input" value={slot.sequence} min="0" max="6" onChange={e => setSlotField(index, 'sequence', CommonUtils.clampToRange(parseInt(e.target.value) || 0, 0, 6))} />
            </div>
            {hasMode && (
              <select className="base-select mode-select has-value" value={slot.mode} onChange={e => setSlotField(index, 'mode', e.target.value)}>
                <option value="None">None</option>
                <option value="Strain">Strain</option>
                <option value="Rupture">Rupture</option>
              </select>
            )}
          </div>
        </div>
      </div>

      {/* 2. Weapon Column */}
      <div className="panel-col">
        {renderAvatar('wep', slot.weapon, IMAGE_FOLDERS.WEAPONS, 'avatar-lg avatar-rect mb-sm')}
        <div className="flex-col gap-sm" style={{ marginTop: 'auto' }}>
          <select className={`base-select wep-select text-bold ${slot.weapon ? 'has-value' : ''}`} value={slot.weapon || ''} disabled={!slot.character} onChange={e => setSlotField(index, 'weapon', e.target.value)}>
            <option value="" disabled hidden>{slot.character ? 'Weapon' : 'Select Character First'}</option>
            {validWeapons.map(w => <option key={w} value={w} disabled={!isContentImplemented('weapon', w)}>{w}</option>)}
          </select>
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
            <select className="base-select layout-select has-value" value={slot.layout} onChange={e => setSlotField(index, 'layout', e.target.value)}>
              {SET_LAYOUTS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="flex-row gap-sm">
            {renderAvatar('mainSet', slot.mainSet, IMAGE_FOLDERS.ECHO_SETS, 'avatar-sm')}
            <select className={`base-select main-set-select ${slot.mainSet ? 'has-value' : ''}`} value={slot.mainSet || ''} onChange={e => setSlotField(index, 'mainSet', e.target.value)}>
              <option value="" disabled hidden>Main Set</option>
              {DataLoader.sonataSets.map(s => <option key={s} value={s} disabled={!isContentImplemented('set', s)}>{s}</option>)}
            </select>
          </div>
          {isTriggerSet && (
            <div className="flex-row gap-sm sub-set-row">
              {renderAvatar('subSet', slot.subSet, IMAGE_FOLDERS.ECHO_SETS, 'avatar-sm')}
              <select className={`base-select sub-set-select ${slot.subSet ? 'has-value' : ''}`} value={slot.subSet || ''} onChange={e => setSlotField(index, 'subSet', e.target.value)}>
                <option value="" disabled hidden>Sub Set</option>
                {DataLoader.sonataSets.map(s => <option key={s} value={s} disabled={!isContentImplemented('set', s)}>{s}</option>)}
              </select>
            </div>
          )}
          {slot.mainSet && (
            <div className="flex-row gap-sm main-echo-row">
              {renderAvatar('mainEcho', slot.mainEcho, IMAGE_FOLDERS.ECHOES, 'avatar-sm')}
              <select className={`base-select main-echo-select ${slot.mainEcho ? 'has-value' : ''}`} value={slot.mainEcho || ''} onChange={e => setSlotField(index, 'mainEcho', e.target.value)}>
                <option value="" disabled hidden>Main Echo</option>
                {allowedEchoes.map(e => <option key={e} value={e} disabled={!isContentImplemented('echo', e)}>{e}</option>)}
              </select>
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