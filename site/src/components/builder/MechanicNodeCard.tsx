// src/components/builder/MechanicNodeCard.tsx
// Orchestrates one MechanicNode's row in the mech-table: owns which sub-panel (if any) is
// open, the handful of "add" fields that are shared between the summary row's click-to-edit
// chips and their matching sub-panel, and renders the summary row plus whichever panel is
// active. Each panel's own fields (effects array, cancel timings, hit breakdown, etc.) are
// fully self-contained in their own component under ./panels -- see there to edit one.
import React, { useState, useRef, useEffect } from 'react';
import type { MechanicNode } from '../../types';
import { useBuilderStore } from '../../store/useBuilderStore';
import { DataLoader } from '../../utils/DataLoader';
import { BuilderState } from '../../data/db';
import { SummaryRow } from './SummaryRow';
import { IdentityPanel } from './panels/IdentityPanel';
import { InputsPhysicsPanel } from './panels/InputsPhysicsPanel';
import { TimingModsPanel } from './panels/TimingModsPanel';
import { HitBreakdownPanel } from './panels/HitBreakdownPanel';
import { AddCastTypePanel } from './panels/AddCastTypePanel';
import { AddDmgTypePanel } from './panels/AddDmgTypePanel';
import { AddCastResourcePanel } from './panels/AddCastResourcePanel';
import { TriggerRuleEffectsPanel } from './panels/TriggerRuleEffectsPanel';
import type { DropdownOption } from '../common/Dropdown';

interface MechanicNodeCardProps {
  nodeId: string;
  data: MechanicNode;
}

export type PanelKey = 'identity' | 'inputs' | 'timeMods' | 'hits' | 'castTags' | 'dmgTags' | 'castRes' | 'default';

// Which JSON fields each sub-panel actually edits -- drives JsonOutputPane's field-level
// highlight while that panel is open, so the reader can see exactly what a click will touch
// without hunting for it in the raw JSON. Keep in sync with each panel's own updateNode calls.
const PANEL_FIELDS: Record<PanelKey, string[]> = {
  identity: ['name', 'provider'],
  inputs: ['input', 'inputType', 'stanceReq', 'stanceResult', 'stanceTime', 'holdConfig'],
  timeMods: ['freezeTime', 'swapTiming', 'priority', 'comboWindow', 'cancelTimings'],
  hits: ['scalar', 'hitMults', 'damageTimeframe', 'hitResources'],
  castTags: ['castTypes'],
  dmgTags: ['dmgTypes'],
  castRes: ['castResources'],
  default: ['triggerRule', 'isPassive', 'isSwapInDefault', 'effects']
};

export const MechanicNodeCard: React.FC<MechanicNodeCardProps> = ({ nodeId, data }) => {
  const { setMechanicNode, removeMechanicNode, activeChar, baseStats, setHighlightedNodeId, setActivePanelHighlight, setHoveredPanelNodeId } = useBuilderStore();
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelHoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Which column's sub-panel is open, if any -- exactly one at a time, mirroring the rotation
  // table's activeTrigger/SubPanel pattern instead of a floating popover.
  const [activeTrigger, setActiveTrigger] = useState<PanelKey | null>(null);
  const toggleTrigger = (key: PanelKey) => (e: React.MouseEvent) => {
    e.stopPropagation();
    // Both setters run directly in this handler, not nested inside setActiveTrigger's updater --
    // that form runs during React's render phase, where updating a different store/component
    // (setActivePanelHighlight touches JsonOutputPane too) throws "Cannot update a component
    // while rendering a different component".
    const next = activeTrigger === key ? null : key;
    setActiveTrigger(next);
    setActivePanelHighlight(next ? { nodeId, fields: PANEL_FIELDS[next] } : null);
  };

  // These 4 fields are shared between the summary row (clicking a chip seeds them back in for
  // editing) and their matching "Add" panel below -- everything else a panel needs is fully
  // local to that panel's own component.
  const [castSelect, setCastSelect] = useState(BuilderState.CAST_OPTIONS[0]);
  const [dmgSelect, setDmgSelect] = useState(BuilderState.DMG_OPTIONS[0]);
  const [castResType, setCastResType] = useState('energy');
  const [castResAmt, setCastResAmt] = useState('');

  // Removing this node (or navigating away entirely) while its panel was open would otherwise
  // leave a stale field-highlight pointing at a node no longer in the tree.
  useEffect(() => () => {
    if (useBuilderStore.getState().activePanelHighlight?.nodeId === nodeId) setActivePanelHighlight(null);
    if (useBuilderStore.getState().hoveredPanelNodeId === nodeId) setHoveredPanelNodeId(null);
  }, [nodeId]);

  // Whole-node highlight -- summary row only, so it doesn't also light up while the mouse is
  // just resting inside the open sub-panel's own inputs below.
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

  // Field highlight -- summary row *or* the open sub-panel, since that's the field-level detail
  // the user is actively working with either way. Attached to both <tr>s below, separate from
  // the whole-node handlers above so the two highlights can respond to different hover regions.
  const handlePanelAreaMouseEnter = () => {
    if (panelHoverTimeoutRef.current) clearTimeout(panelHoverTimeoutRef.current);
    panelHoverTimeoutRef.current = setTimeout(() => {
      setHoveredPanelNodeId(nodeId);
    }, 50);
  };

  const handlePanelAreaMouseLeave = () => {
    if (panelHoverTimeoutRef.current) clearTimeout(panelHoverTimeoutRef.current);
    setHoveredPanelNodeId(null);
  };

  const updateNode = (patch: Partial<MechanicNode>) => {
    setMechanicNode(nodeId, { ...data, ...patch });
  };

  const dbC = (activeChar && DataLoader.characterDB[activeChar])
    ? DataLoader.characterDB[activeChar]
    : ({} as Record<string, any>);

  // Check live baseStats first, fallback to DB. Shared by the Add Cast Resource panel and the
  // Trigger Rule & Effects panel's Resource-type effect (both offer "which forte slot").
  const forteCount = parseInt((baseStats.forteCount as any) || dbC.forteCount || 1, 10);
  const forteOptions: DropdownOption[] = [];
  for (let i = 1; i <= forteCount; i++) {
    forteOptions.push({ value: `forte${i}`, label: `Forte ${i}` });
  }

  const renderPanel = () => {
    switch (activeTrigger) {
      case 'identity':
        return <IdentityPanel nodeId={nodeId} data={data} updateNode={updateNode} />;
      case 'inputs':
        return <InputsPhysicsPanel data={data} updateNode={updateNode} />;
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
      case 'default':
      default:
        return <TriggerRuleEffectsPanel data={data} updateNode={updateNode} forteOptions={forteOptions} />;
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
        setActiveTrigger={(key) => setActiveTrigger(key)}
        removeMechanicNode={removeMechanicNode}
        onMouseEnter={() => { handleMouseEnter(); handlePanelAreaMouseEnter(); }}
        onMouseLeave={() => { handleMouseLeave(); handlePanelAreaMouseLeave(); }}
        setCastSelect={setCastSelect}
        setDmgSelect={setDmgSelect}
        setCastResType={setCastResType}
        setCastResAmt={setCastResAmt}
      />

      {activeTrigger && (
        <tr onMouseEnter={handlePanelAreaMouseEnter} onMouseLeave={handlePanelAreaMouseLeave}>
          <td colSpan={12} className="mech-detail-cell">
            {renderPanel()}
          </td>
        </tr>
      )}
    </tbody>
  );
};
