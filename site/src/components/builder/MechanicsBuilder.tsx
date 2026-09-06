import React, { useState } from 'react';
import { useBuilderStore, mechFolderFor } from '../../store/useBuilderStore';
import { checkBuilderItemFreshness } from '../../utils/dataFreshness';
import { DataLoader } from '../../utils/DataLoader';
import { CommonUtils } from '../../utils/Common';
import { BuilderUtils } from '../../utils/BuilderUtils';
import { BaseStatsForm } from './BaseStatsForm';
import { MechanicNodeCard } from './MechanicNodeCard';
import { JsonOutputPane } from './JsonOutputPane';
import { BuilderState, IMAGE_FOLDERS, isContentImplemented, type ImplementedContentKind } from '../../data/db';
import type { MechanicNode } from '../../types';
import type { ImageFolder } from '../../data/db';
import { tip } from './mechanicNodeHelpers';
import { TooltipManager } from '../../utils/Common';
import { Dropdown } from '../common/Dropdown';

// Maps a grid section's image folder to the isContentImplemented() kind it should be checked
// against -- 'System' (the Generic entry) has no implemented-content notion, so it's always
// treated as implemented.
const IMPLEMENTED_KIND_BY_FOLDER: Partial<Record<ImageFolder, ImplementedContentKind>> = {
  [IMAGE_FOLDERS.CHARACTERS]: 'character',
  [IMAGE_FOLDERS.WEAPONS]: 'weapon',
  [IMAGE_FOLDERS.ECHO_SETS]: 'set',
  [IMAGE_FOLDERS.ECHOES]: 'echo'
};

interface GridCardProps {
  itemName: string;
  imgFolder: ImageFolder;
  dbRef?: Record<string, any>;
  onClick: (rarity: number) => void;
  hasChanges: boolean;
}

const GridCard: React.FC<GridCardProps> = ({ itemName, imgFolder, dbRef, onClick, hasChanges }) => {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  let rarity = 5;
  let rarityClass = 'rarity-none';
  let iconClass = 'char-icon';

  if (imgFolder === IMAGE_FOLDERS.CHARACTERS || imgFolder === IMAGE_FOLDERS.WEAPONS) {
    rarity = dbRef?.[itemName]?.rarity || 5;
    rarityClass = `rarity-${rarity}`;
  } else if (imgFolder === IMAGE_FOLDERS.ECHO_SETS || imgFolder === IMAGE_FOLDERS.SYSTEM) {
    iconClass += ' echo-set-icon';
  }

  const fontSize = imgFolder === IMAGE_FOLDERS.CHARACTERS ? '0.8em' : '0.65em';
  const iconPath = CommonUtils.getIconPath(itemName, imgFolder);
  const implementedKind = IMPLEMENTED_KIND_BY_FOLDER[imgFolder];
  const isImplemented = !implementedKind || isContentImplemented(implementedKind, itemName) || hasChanges;

  return (
    <div
      className={`char-grid-card ${isImplemented ? '' : 'is-unimplemented'}`}
      onClick={() => {
        // The whole grid unmounts on selection, so a hovered card never gets a natural
        // mouseleave to clear its tooltip -- hide it explicitly before navigating away.
        TooltipManager.hide();
        onClick(rarity);
      }}
      {...(!isImplemented ? tip('Not yet implemented -- click to start authoring its mechanics') : {})}
    >
      {hasChanges && (
        // Rendered as a sibling of .char-icon (which clips via overflow:hidden for its rounded
        // top corners), not a child of it -- so the badge can hang half outside the icon's own
        // corner like a real app notification badge instead of being clipped to sit inside it.
        <span className="char-grid-dirty-badge" {...tip('Has locally cached changes')}>
          <svg viewBox="0 0 24 24">
            <path className="dirty-badge-shape" d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line className="dirty-badge-mark" x1="12" y1="9" x2="12" y2="13" />
            <line className="dirty-badge-mark" x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </span>
      )}
      <div className={`${iconClass} ${rarityClass}`}>
        {!imgError && (
          <img
            className={`char-grid-img ${imgLoaded ? 'opacity-1' : 'opacity-0'}`}
            src={iconPath}
            alt={itemName}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
          />
        )}
        {(!imgLoaded || imgError) && (
          <span className="char-fallback">{itemName.charAt(0)}</span>
        )}
      </div>
      <div
        className="char-name-label"
        style={{
          fontSize,
          lineHeight: 1.2,
          whiteSpace: 'normal',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical'
        }}
      >
        {itemName}
      </div>
    </div>
  );
};

export const MechanicsBuilder: React.FC = () => {
  const { activeChar, setActiveChar, mechanics, setMechanicNode, baseStats, setBaseStat, hasChanges } = useBuilderStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTemplates, setSelectedTemplates] = useState<Record<string, string>>({});

  if (!activeChar) {
    const buildSection = (
      title: string,
      items: string[],
      dbRef: Record<string, any> | undefined,
      imgFolder: ImageFolder
    ) => {
      const filtered = items.filter(item =>
        item.toLowerCase().includes(searchTerm.toLowerCase().trim())
      );
      if (!filtered || filtered.length === 0) return null;

      return (
        <div key={title} className="grid-section" style={{ width: '100%' }}>
          <div
            className="text-gold mb-4px"
            style={{ fontSize: '1.1em', fontWeight: 'bold', borderBottom: '1px solid #444', paddingBottom: '4px' }}
          >
            {title}
          </div>
          <div
            className="item-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(85px, 1fr))',
              gap: '12px',
              marginTop: '12px',
              width: '100%'
            }}
          >
            {filtered.map(itemName => (
              <GridCard
                key={itemName}
                itemName={itemName}
                imgFolder={imgFolder}
                dbRef={dbRef}
                onClick={async rarity => {
                  // Before opening this entity for editing, make sure its cached mechanic JSON
                  // isn't stale relative to the server -- silently evicted (and re-fetched by
                  // setActiveChar below) unless the user has unsaved local edits to it, in which
                  // case a conflict dialog is raised instead (see useFreshnessConflictStore).
                  await checkBuilderItemFreshness(mechFolderFor(imgFolder), itemName);
                  setActiveChar(itemName, imgFolder, rarity);
                }}
                hasChanges={hasChanges(itemName)}
              />
            ))}
          </div>
        </div>
      );
    };

    return (
      <div id="view-grid" className="builder-view" style={{ flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}>
        <div style={{ padding: '20px 20px 16px 20px', flexShrink: 0 }}>
          <input
            type="text"
            id="grid-search-input"
            className="form-input"
            placeholder="Search Characters, Weapons, Echoes..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              maxWidth: '400px',
              padding: '10px 15px',
              fontSize: '0.9rem',
              background: 'var(--bg-well)',
              borderRadius: '6px'
            }}
          />
        </div>

        <div
          id="character-grid"
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            overflowY: 'auto',
            padding: '0 20px 20px 20px',
            width: '100%',
            boxSizing: 'border-box'
          }}
        >
          {buildSection('Characters', Object.keys(DataLoader.characterDB), DataLoader.characterDB, IMAGE_FOLDERS.CHARACTERS)}
          {buildSection('Weapons', Object.keys(DataLoader.weaponDB), DataLoader.weaponDB, IMAGE_FOLDERS.WEAPONS)}
          {buildSection('Main Echoes', DataLoader.allMainEchoes, undefined, IMAGE_FOLDERS.ECHOES)}
          {buildSection('Echo Sets', DataLoader.sonataSets, undefined, IMAGE_FOLDERS.ECHO_SETS)}
          {buildSection('System', ['Generic'], undefined, IMAGE_FOLDERS.SYSTEM)}
        </div>
      </div>
    );
  }

  const isCharacter = !!DataLoader.characterDB[activeChar];
  const isWeapon = !!DataLoader.weaponDB[activeChar];
  const isSonataSet = DataLoader.sonataSets.includes(activeChar);
  const isTriggerSet = DataLoader.triggerSets.includes(activeChar);

  // Determine correct accordion categories based on entity type
  let targetCategories: string[] = [];
  if (activeChar === 'Generic') {
    targetCategories = ['System Mechanics'];
  } else if (isCharacter) {
    targetCategories = BuilderState.categories;
  } else if (isWeapon) {
    targetCategories = ['Weapon Passive'];
  } else if (isSonataSet) {
    targetCategories = isTriggerSet ? ['3-pc Set Effect'] : ['2-pc Set Effect', '5-pc Set Effect'];
  } else {
    targetCategories = ['Echo Skill', 'Echo Passive'];
  }

  const getDefaultTemplateKey = (cat: string) => {
    const keys = Object.keys(BuilderState.templates);
    return keys.find(k => k === cat || k.startsWith(cat)) || keys[0];
  };

  const handleAddNode = (category: string) => {
    const tmplKey = selectedTemplates[category] || getDefaultTemplateKey(category);
    const template: MechanicNode = JSON.parse(
      JSON.stringify(
        (BuilderState.templates as Record<string, any>)[tmplKey] || {
          name: 'New Mechanic',
          triggerRule: '',
          isPassive: false
        }
      )
    );

    // Swap default template element ('Glacio') with active character's element
    if (isCharacter && DataLoader.characterDB[activeChar]?.element) {
      const charElement = DataLoader.characterDB[activeChar].element;
      const elements = ['Glacio', 'Aero', 'Electro', 'Fusion', 'Spectro', 'Havoc', 'Physical'];
      if ((template.dmgTypes || []).length === 0 && !template.isPassive) {
        template.dmgTypes = [charElement];
      } else if (template.dmgTypes) {
        template.dmgTypes = template.dmgTypes.map(t => (elements.includes(t) ? charElement : t));
      }
    }

    const provider = activeChar || 'System';
    let nodeId = BuilderUtils.generateId(provider, template.name);
    if (mechanics[nodeId]) {
      let suffix = 2;
      while (mechanics[`${nodeId} (${suffix})`]) suffix++;
      nodeId = `${nodeId} (${suffix})`;
      template.name = `${template.name} (${suffix})`;
    }
    setMechanicNode(nodeId, { ...template, category, provider } as MechanicNode);
  };

  const skillGroupNames = baseStats.skillGroupNames || {};

  return (
    <div id="view-editor" className="builder-view" style={{ flex: 1, minHeight: 0, height: '100%' }}>
      <div className="editor-pane scrollable" style={{ flex: 3, overflowY: 'auto', minHeight: 0 }}>
        <div className="panel-header-main" id="editor-char-name">
          {activeChar.toUpperCase()} SETUP
        </div>
        <BaseStatsForm />
        <div id="mechanics-accordion" className="flex-col gap-md" style={{ marginTop: '20px' }}>
          {targetCategories.map((cat: string) => {
            const catMechs = (Object.entries(mechanics) as [string, MechanicNode][]).filter(([id, m]) => {
              if (m.category && targetCategories.includes(m.category)) return m.category === cat;
              if (activeChar === 'Generic') return cat === 'System Mechanics';
              if (!isCharacter) {
                if (targetCategories.includes('Echo Skill')) {
                  const isPassive = !!m.isPassive || id.toLowerCase().includes('passive') || (m.name || '').toLowerCase().includes('passive') ||
                    (m.triggerRule && m.triggerRule.trim().startsWith('ALWAYS'));
                  return isPassive ? cat === 'Echo Passive' : cat === 'Echo Skill';
                }
                if (targetCategories.length === 1) return cat === targetCategories[0];
                const is2pc = (m.name || '').includes('2-pc') || id.includes('2pc');
                return cat === (is2pc ? '2-pc Set Effect' : '5-pc Set Effect');
              }
              return BuilderUtils.guessCategory(m) === cat;
            });

            return (
              <div key={cat} className="mechanic-category" data-category={cat}>
                <div className="mechanic-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                    <span className="text-bold text-gold">{cat}</span>
                    {isCharacter && (
                      <input
                        type="text"
                        className="form-input category-group-name"
                        value={skillGroupNames[cat] || ''}
                        placeholder="Skill Category Name"
                        onChange={e => {
                          const updated = { ...skillGroupNames, [cat]: e.target.value };
                          setBaseStat('skillGroupNames', updated);
                        }}
                        style={{ height: '24px', fontSize: '0.8rem', width: '280px', borderColor: 'var(--border)', background: 'rgba(0,0,0,0.2)' }}
                      />
                    )}
                  </div>
                  <div className="flex-row gap-sm w-auto">
                    <Dropdown
                      className="base-select template-select w-150px"
                      value={selectedTemplates[cat] || getDefaultTemplateKey(cat)}
                      onChange={v => setSelectedTemplates({ ...selectedTemplates, [cat]: v })}
                      options={Object.keys(BuilderState.templates).map(k => ({
                        value: k,
                        label: (BuilderState.templates as any)[k].name
                      }))}
                    />
                    <button type="button" className="base-btn text-xs add-node-btn" onClick={() => handleAddNode(cat)}>
                      Add Node
                    </button>
                  </div>
                </div>
                <div className="nodes-container">
                  {catMechs.length > 0 && (
                    <table className="mech-table">
                      <colgroup>
                        <col style={{ width: '2.5%' }} />
                        <col style={{ width: '29%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '7%' }} />
                        <col style={{ width: '6%' }} />
                        <col style={{ width: '6%' }} />
                        <col style={{ width: '10%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '5%' }} />
                        <col style={{ width: '2.5%' }} />
                      </colgroup>
                      <thead>
                        <tr className="mech-group-row">
                          <th></th>
                          <th colSpan={4}>Identity</th>
                          <th></th>
                          <th colSpan={2}>Timing</th>
                          <th colSpan={2}>Resources</th>
                          <th></th>
                          <th className="mech-col-remove"></th>
                        </tr>
                        <tr>
                          <th></th>
                          <th className="mech-col-name">Name</th>
                          <th>Cast Types</th>
                          <th>Dmg Types</th>
                          <th>Inputs</th>
                          <th>Mult</th>
                          <th>Frame #</th>
                          <th>Time Mods</th>
                          <th>On Cast</th>
                          <th>On Hit</th>
                          <th>CD</th>
                          <th className="mech-col-remove"></th>
                        </tr>
                      </thead>
                      {catMechs.map(([id, node]) => (
                        <MechanicNodeCard key={id} nodeId={id} data={node} />
                      ))}
                    </table>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <JsonOutputPane />
    </div>
  );
};