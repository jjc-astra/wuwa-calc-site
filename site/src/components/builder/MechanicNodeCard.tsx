// One node's summary row and its open sub-panel.
import React, { useState, useRef, useEffect } from 'react';
import type { MechanicNode } from '../../types';
import { useBuilderStore } from '../../store/useBuilderStore';
import { DataLoader } from '../../utils/DataLoader';
import { BuilderState } from '../../data/db';
import { forteLabel } from '../../utils/ForteNames';
import { forteKey } from '../../utils/ResourceKeys';
import { SummaryRow } from './SummaryRow';
import { IdentityPanel } from './panels/IdentityPanel';
import { InputsPhysicsPanel } from './panels/InputsPhysicsPanel';
import { TimingModsPanel } from './panels/TimingModsPanel';
import { HitBreakdownPanel } from './panels/HitBreakdownPanel';
import { AddCastTypePanel } from './panels/AddCastTypePanel';
import { AddDmgTypePanel } from './panels/AddDmgTypePanel';
import { AddCastResourcePanel } from './panels/AddCastResourcePanel';
import { TriggerRuleEffectsPanel } from './panels/TriggerRuleEffectsPanel';
import { CooldownPanel } from './panels/CooldownPanel';
import type { DropdownOption } from '../common/Dropdown';

interface MechanicNodeCardProps {
  nodeId: string;
  data: MechanicNode;
  groupSiblings?: { repeat?: [string, MechanicNode]; release?: [string, MechanicNode] };
  childOfHold?: 'Repeat' | 'Release';
  // Drag-to-reorder, owned by MechanicsBuilder.
  dragDisabled?: boolean;
  isDragging?: boolean;
  dragOverPosition?: 'before' | 'after' | null;
  onRowDragStart?: (e: React.DragEvent, nodeId: string) => void;
  onRowDragOver?: (e: React.DragEvent, nodeId: string) => void;
  onRowDragLeave?: (e: React.DragEvent) => void;
  onRowDrop?: (e: React.DragEvent, nodeId: string) => void;
  onRowDragEnd?: (e: React.DragEvent) => void;
}

export type PanelKey = 'identity' | 'inputs' | 'timeMods' | 'hits' | 'castTags' | 'dmgTags' | 'castRes' | 'cooldown';

// Fields each sub-panel edits, for highlighting. Sync with the panels' updateNode calls.
const PANEL_FIELDS: Record<PanelKey, string[]> = {
  identity: ['name', 'provider', 'triggerRule', 'isPassive', 'isSwapInDefault', 'modeScope', 'effects'],
  inputs: ['input', 'inputType', 'stanceReq', 'stanceChanges', 'holdConfig'],
  timeMods: ['freezeTime', 'motionStop', 'swapTiming', 'priority', 'comboWindow', 'cancelTimings'],
  hits: ['scalar', 'hitMults', 'damageTimeframe', 'hitFrames', 'hitResources'],
  castTags: ['castTypes'],
  dmgTags: ['dmgTypes'],
  castRes: ['castResources'],
  cooldown: ['cooldown', 'maxCharges', 'shareCooldownWith']
};

export const MechanicNodeCard: React.FC<MechanicNodeCardProps> = ({
  nodeId, data, groupSiblings, childOfHold,
  dragDisabled, isDragging, dragOverPosition, onRowDragStart, onRowDragOver, onRowDragLeave, onRowDrop, onRowDragEnd
}) => {
  const { setMechanicNode, softRemoveMechanicNode, activeChar, baseStats, setHighlightedNodeId, setHoveredFieldHighlight, setOpenPanel } = useBuilderStore();
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Shared debounce so moving between targets doesn't flicker.
  const fieldHoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeTrigger = useBuilderStore(state => state.openPanelByNode[nodeId] ?? null);
  const toggleTrigger = (key: PanelKey) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenPanel(nodeId, activeTrigger === key ? null : key);
  };

  const enterFieldHover = (key: PanelKey, targetId: string = nodeId) => {
    if (fieldHoverTimeoutRef.current) clearTimeout(fieldHoverTimeoutRef.current);
    fieldHoverTimeoutRef.current = setTimeout(() => {
      setHoveredFieldHighlight({ nodeId: targetId, fields: PANEL_FIELDS[key] });
    }, 50);
  };
  const leaveFieldHover = () => {
    if (fieldHoverTimeoutRef.current) clearTimeout(fieldHoverTimeoutRef.current);
    fieldHoverTimeoutRef.current = setTimeout(() => {
      setHoveredFieldHighlight(null);
    }, 50);
  };

  // Shared by the summary chips and the Add panels.
  const [castSelect, setCastSelect] = useState(BuilderState.CAST_OPTIONS[0]);
  const [dmgSelect, setDmgSelect] = useState(BuilderState.DMG_OPTIONS[0]);
  const [castResType, setCastResType] = useState('energy');
  const [castResAmt, setCastResAmt] = useState('');

  // Clear highlights on unmount.
  useEffect(() => () => {
    if (useBuilderStore.getState().highlightedNodeId === nodeId) setHighlightedNodeId(null);
    if (useBuilderStore.getState().hoveredFieldHighlight?.nodeId === nodeId) setHoveredFieldHighlight(null);
  }, [nodeId]);

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setHighlightedNodeId(nodeId);
    }, 50);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setHighlightedNodeId(null);
  };

  const updateNode = (patch: Partial<MechanicNode>) => {
    setMechanicNode(nodeId, { ...data, ...patch });
  };

  const dbC = (activeChar && DataLoader.characterDB[activeChar])
    ? DataLoader.characterDB[activeChar]
    : ({} as Record<string, any>);

  const forteCount = parseInt((baseStats.forteCount as any) || dbC.forteCount || 1, 10);
  const forteOptions: DropdownOption[] = [];
  for (let i = 1; i <= forteCount; i++) {
    forteOptions.push({ value: forteKey(i), label: forteLabel(baseStats, i) });
  }

  const renderPanel = (trigger: PanelKey) => {
    switch (trigger) {
      case 'identity':
        return (
          <>
            <IdentityPanel nodeId={nodeId} data={data} updateNode={updateNode} />
            <TriggerRuleEffectsPanel data={data} updateNode={updateNode} forteOptions={forteOptions} groupSiblings={groupSiblings} nodeId={nodeId} />
          </>
        );
      case 'inputs':
        return <InputsPhysicsPanel data={data} updateNode={updateNode} forteOptions={forteOptions} groupSiblings={data.inputType !== 'Repeat' ? groupSiblings : undefined} />;
      case 'timeMods':
        return <TimingModsPanel data={data} updateNode={updateNode} />;
      case 'hits':
        return <HitBreakdownPanel nodeId={nodeId} data={data} updateNode={updateNode} forteOptions={forteOptions} />;
      case 'castTags':
        return <AddCastTypePanel data={data} updateNode={updateNode} castSelect={castSelect} setCastSelect={setCastSelect} />;
      case 'dmgTags':
        return <AddDmgTypePanel data={data} updateNode={updateNode} dmgSelect={dmgSelect} setDmgSelect={setDmgSelect} />;
      case 'castRes':
        return (
          <AddCastResourcePanel
            data={data}
            updateNode={updateNode}
            castResType={castResType}
            setCastResType={setCastResType}
            castResAmt={castResAmt}
            setCastResAmt={setCastResAmt}
            forteOptions={forteOptions}
          />
        );
      case 'cooldown':
        return <CooldownPanel data={data} updateNode={updateNode} />;
    }
  };

  return (
    <tbody className="mech-row-group">
      <SummaryRow
        nodeId={nodeId}
        data={data}
        updateNode={updateNode}
        activeTrigger={activeTrigger}
        toggleTrigger={toggleTrigger}
        setActiveTrigger={(key) => setOpenPanel(nodeId, key)}
        removeMechanicNode={softRemoveMechanicNode}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFieldMouseEnter={enterFieldHover}
        onFieldMouseLeave={leaveFieldHover}
        setCastSelect={setCastSelect}
        setDmgSelect={setDmgSelect}
        setCastResType={setCastResType}
        setCastResAmt={setCastResAmt}
        groupSiblings={groupSiblings}
        childOfHold={childOfHold}
        draggable={!dragDisabled && activeTrigger === null}
        isDragging={!!isDragging}
        dragOverPosition={dragOverPosition ?? null}
        onDragStart={onRowDragStart ? (e: React.DragEvent) => onRowDragStart(e, nodeId) : undefined}
        onDragOver={onRowDragOver ? (e: React.DragEvent) => onRowDragOver(e, nodeId) : undefined}
        onDragLeave={onRowDragLeave}
        onDrop={onRowDrop ? (e: React.DragEvent) => onRowDrop(e, nodeId) : undefined}
        onDragEnd={onRowDragEnd}
      />

      {activeTrigger && (
        <tr onMouseEnter={() => enterFieldHover(activeTrigger)} onMouseLeave={leaveFieldHover}>
          <td colSpan={12} className="mech-detail-cell">
            {renderPanel(activeTrigger)}
          </td>
        </tr>
      )}
    </tbody>
  );
};
