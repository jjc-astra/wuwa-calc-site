import React, { useState } from 'react';
import { useBuilderStore, mechFolderFor } from '../../store/useBuilderStore';
import { checkBuilderItemFreshness } from '../../utils/dataFreshness';
import { DataLoader, type ImplementedContentKind } from '../../utils/DataLoader';
import { BuilderUtils } from '../../utils/BuilderUtils';
import { MechanicKey } from '../../utils/MechanicKey';
import { BaseStatsForm } from './BaseStatsForm';
import { MechanicNodeCard } from './MechanicNodeCard';
import { JsonOutputPane } from './JsonOutputPane';
import { BuilderState, IMAGE_FOLDERS } from '../../data/db';
import { isElement } from '../../data/gameVocab';
import type { MechanicNode } from '../../types';
import type { ImageFolder } from '../../data/db';
import { tip } from './mechanicNodeHelpers';
import { Dropdown } from '../common/Dropdown';
import { LibraryCard, LibrarySection, LibrarySearchInput, matchesLibrarySearch } from '../common/LibraryGrid';

// Maps a grid section's image folder to the isContentImplemented() kind to check.
// 'System' has no implemented-content notion, so it's always treated as implemented.
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

// A library card plus the Builder's own state: rarity, "not yet implemented" dimming and the
// unsaved-changes badge.
const GridCard: React.FC<GridCardProps> = ({ itemName, imgFolder, dbRef, onClick, hasChanges }) => {
  const hasRarity = imgFolder === IMAGE_FOLDERS.CHARACTERS || imgFolder === IMAGE_FOLDERS.WEAPONS;
  const rarity = hasRarity ? dbRef?.[itemName]?.rarity || 5 : 5;
  const implementedKind = IMPLEMENTED_KIND_BY_FOLDER[imgFolder];
  const isImplemented = !implementedKind || DataLoader.isContentImplemented(implementedKind, itemName) || hasChanges;

  return (
    <LibraryCard
      itemName={itemName}
      imgFolder={imgFolder}
      rarity={rarity}
      dimmed={!isImplemented}
      dimmedTooltip="Not yet implemented -- click to start authoring its mechanics"
      onClick={() => onClick(rarity)}
      badge={hasChanges && (
        // Sibling of .char-icon (not a child) -- .char-icon clips via overflow:hidden for its
        // rounded corners, so this lets the badge hang half outside like a real notification badge.
        <span className="char-grid-dirty-badge" {...tip('Has locally cached changes')}>
          <svg viewBox="0 0 24 24">
            <path className="dirty-badge-shape" d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line className="dirty-badge-mark" x1="12" y1="9" x2="12" y2="13" />
            <line className="dirty-badge-mark" x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </span>
      )}
    />
  );
};

// Groups Hold/Repeat/Release siblings into a single card via explicit holdGroupId, falling back to legacy input+role matching.
function resolveHoldGroups(allMechs: Record<string, MechanicNode>) {
  const entries = Object.entries(allMechs);
  const skipIds = new Set<string>();
  const groupSiblings: Record<string, { repeat?: [string, MechanicNode]; release?: [string, MechanicNode] }> = {};

  entries.forEach(([holdId, holdNode]) => {
    if (holdNode.inputType !== 'Hold') return;
    let repeat: [string, MechanicNode] | undefined;
    let release: [string, MechanicNode] | undefined;

    // Matches explicit holdGroupId first, supporting partial migrations where only one sibling has adopted an ID so far.
    if (holdNode.holdGroupId) {
      entries.forEach(([id, m]) => {
        if (id === holdId || m.holdGroupId !== holdNode.holdGroupId) return;
        if (m.inputType === 'Repeat') repeat = [id, m];
        else if (m.inputType === 'Release') release = [id, m];
      });
    }
    // Legacy fallback matching unassigned nodes by both input and category, preventing basic charged attacks from stealing group releases.
    entries.forEach(([id, m]) => {
      if (id === holdId || m.holdGroupId || m.input !== holdNode.input || m.category !== holdNode.category) return;
      if (m.inputType === 'Repeat' && !repeat) repeat = [id, m];
      else if (m.inputType === 'Release' && !!m.holdConfig && !release) release = [id, m];
    });

    if (repeat || release) {
      groupSiblings[holdId] = { repeat, release };
      if (repeat) skipIds.add(repeat[0]);
      if (release) skipIds.add(release[0]);
    }
  });

  return { skipIds, groupSiblings };
}

export const MechanicsBuilder: React.FC = () => {
  const { activeChar, setActiveChar, mechanics, setMechanicNode, reorderMechanicNode, baseStats, setBaseStat, hasChanges } = useBuilderStore();
  const { skipIds: holdGroupSkipIds, groupSiblings: holdGroupSiblings } = resolveHoldGroups(mechanics);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTemplates, setSelectedTemplates] = useState<Record<string, string>>({});

  // Drag-to-reorder for the summary table rows -- one dragged id + drop target shared across
  // every category table, since only one drag gesture can be in flight at a time.
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dragOverInfo, setDragOverInfo] = useState<{ nodeId: string; position: 'before' | 'after' } | null>(null);

  const handleRowDragStart = (e: React.DragEvent, nodeId: string) => {
    setDraggedNodeId(nodeId);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleRowDragOver = (e: React.DragEvent, nodeId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!draggedNodeId || draggedNodeId === nodeId) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isBelow = e.clientY > rect.top + rect.height / 2;
    setDragOverInfo({ nodeId, position: isBelow ? 'after' : 'before' });
  };
  const handleRowDragLeave = () => setDragOverInfo(null);
  const handleRowDrop = (e: React.DragEvent, nodeId: string) => {
    e.preventDefault();
    if (draggedNodeId && draggedNodeId !== nodeId) {
      reorderMechanicNode(draggedNodeId, nodeId, dragOverInfo?.position === 'after' ? 'after' : 'before');
    }
    setDraggedNodeId(null);
    setDragOverInfo(null);
  };
  const handleRowDragEnd = () => {
    setDraggedNodeId(null);
    setDragOverInfo(null);
  };

  if (!activeChar) {
    const buildSection = (
      title: string,
      items: string[],
      dbRef: Record<string, any> | undefined,
      imgFolder: ImageFolder
    ) => {
      const filtered = items.filter(item => matchesLibrarySearch(item, searchTerm));
      if (filtered.length === 0) return null;

      return (
        <LibrarySection key={title} title={title}>
          {filtered.map(itemName => (
            <GridCard
              key={itemName}
              itemName={itemName}
              imgFolder={imgFolder}
              dbRef={dbRef}
              onClick={async rarity => {
                // Check cached mechanic JSON isn't stale before opening -- silently evicted and
                // refetched (by setActiveChar below), unless unsaved edits raise a conflict dialog.
                await checkBuilderItemFreshness(mechFolderFor(imgFolder), itemName);
                setActiveChar(itemName, imgFolder, rarity);
              }}
              hasChanges={hasChanges(itemName)}
            />
          ))}
        </LibrarySection>
      );
    };

    return (
      <div id="view-grid" className="builder-view" style={{ flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}>
        <LibrarySearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search Characters, Weapons, Echoes..." />

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
          {buildSection('System', ['System'], undefined, IMAGE_FOLDERS.SYSTEM)}
        </div>
      </div>
    );
  }

  const isCharacter = !!DataLoader.characterDB[activeChar];
  const isWeapon = !!DataLoader.weaponDB[activeChar];
  const isSonataSet = DataLoader.sonataSets.includes(activeChar);
  const isThreePcSet = DataLoader.threePcSets.includes(activeChar);
  const isOnePcSet = DataLoader.onePcSets.includes(activeChar);

  let targetCategories: string[] = [];
  if (activeChar === 'System') {
    targetCategories = ['System Mechanics'];
  } else if (isCharacter) {
    targetCategories = BuilderState.categories;
  } else if (isWeapon) {
    targetCategories = ['Weapon Passive'];
  } else if (isSonataSet) {
    targetCategories = isOnePcSet ? ['1-pc Set Effect']
      : isThreePcSet ? ['3-pc Set Effect']
      : ['2-pc Set Effect', '5-pc Set Effect'];
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

    if (isCharacter && DataLoader.characterDB[activeChar]?.element) {
      const charElement = DataLoader.characterDB[activeChar].element;
      if ((template.dmgTypes || []).length === 0 && !template.isPassive) {
        template.dmgTypes = [charElement];
      } else if (template.dmgTypes) {
        template.dmgTypes = template.dmgTypes.map(t => (isElement(t) ? charElement : t));
      }
    }

    const provider = activeChar || 'System';
    let nodeId = MechanicKey.build(provider, template.name);
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
      <div className="editor-pane scrollable" style={{ overflowY: 'auto', minHeight: 0 }}>
        <div className="panel-header-main" id="editor-char-name">
          {activeChar.toUpperCase()} SETUP
        </div>
        <BaseStatsForm />
        <div id="mechanics-accordion" className="flex-col gap-md" style={{ marginTop: '20px' }}>
          {targetCategories.map((cat: string) => {
            const catMechs = (Object.entries(mechanics) as [string, MechanicNode][]).filter(([id, m]) => {
              if (holdGroupSkipIds.has(id)) return false;
              if (m.category && targetCategories.includes(m.category)) return m.category === cat;
              if (activeChar === 'System') return cat === 'System Mechanics';
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
                        style={{ height: '24px', fontSize: '0.8rem', borderColor: 'var(--border)', background: 'rgba(0,0,0,0.2)' }}
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
                      {(() => {
                        const ordered: { id: string; node: MechanicNode; groupSiblings?: typeof holdGroupSiblings[string]; childRole?: 'Repeat' | 'Release' }[] = [];
                        catMechs.forEach(([id, node]) => {
                          const sib = holdGroupSiblings[id];
                          ordered.push({ id, node, groupSiblings: sib });
                          if (sib?.repeat) ordered.push({ id: sib.repeat[0], node: sib.repeat[1], groupSiblings: sib, childRole: 'Repeat' });
                          if (sib?.release) ordered.push({ id: sib.release[0], node: sib.release[1], groupSiblings: sib, childRole: 'Release' });
                        });
                        return ordered.map(({ id, node, groupSiblings, childRole }) => (
                          <MechanicNodeCard
                            key={id}
                            nodeId={id}
                            data={node}
                            groupSiblings={groupSiblings}
                            childOfHold={childRole}
                            dragDisabled={!!childRole}
                            isDragging={draggedNodeId === id}
                            dragOverPosition={dragOverInfo?.nodeId === id ? dragOverInfo.position : null}
                            onRowDragStart={handleRowDragStart}
                            onRowDragOver={handleRowDragOver}
                            onRowDragLeave={handleRowDragLeave}
                            onRowDrop={handleRowDrop}
                            onRowDragEnd={handleRowDragEnd}
                          />
                        ));
                      })()}
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