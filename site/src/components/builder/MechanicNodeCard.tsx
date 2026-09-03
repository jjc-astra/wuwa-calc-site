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
  const { setMechanicNode, removeMechanicNode, activeChar, baseStats, setHighlightedNodeId, setHoveredFieldHighlight } = useBuilderStore();
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Shared by every field-hover source below (each summary-row cell, and the open panel's own
  // body) -- a single ref per node, not one per source, so a fast leave-then-enter across two
  // adjacent hover targets (e.g. a cell into its own now-open panel right below it) cancels the
  // pending "clear" before it ever fires instead of briefly flashing the highlight off and back
  // on. Symmetric 50ms debounce on both enter and leave (the old code only debounced enter,
  // clearing immediately on leave -- that asymmetry is exactly what produced the flicker: leaving
  // the row fired an instant clear, then entering the panel scheduled a fresh 50ms-delayed set,
  // guaranteeing a visible gap in between every time).
  const fieldHoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Which column's sub-panel is open, if any -- exactly one at a time, mirroring the rotation
  // table's activeTrigger/SubPanel pattern instead of a floating popover.
  const [activeTrigger, setActiveTrigger] = useState<PanelKey | null>(null);
  const toggleTrigger = (key: PanelKey) => (e: React.MouseEvent) => {
    e.stopPropagation();
    // Opening/closing a panel no longer touches the field highlight at all -- that's now purely
    // hover-driven (see enterFieldHover/leaveFieldHover below), already active for this cell by
    // the time it's clicked (the mouse has to be over the cell to click it).
    setActiveTrigger(activeTrigger === key ? null : key);
  };

  // Field highlight -- previews a sub-panel's edited fields while the mouse is over the specific
  // summary-row cell that opens it, OR over that panel's own body once it's open. Independent of
  // highlightedNodeId (whole-node, row-only) so the two can respond to different hover regions.
  const enterFieldHover = (key: PanelKey) => {
    if (fieldHoverTimeoutRef.current) clearTimeout(fieldHoverTimeoutRef.current);
    fieldHoverTimeoutRef.current = setTimeout(() => {
      setHoveredFieldHighlight({ nodeId, fields: PANEL_FIELDS[key] });
    }, 50);
  };
  const leaveFieldHover = () => {
    if (fieldHoverTimeoutRef.current) clearTimeout(fieldHoverTimeoutRef.current);
    fieldHoverTimeoutRef.current = setTimeout(() => {
      setHoveredFieldHighlight(null);
    }, 50);
  };

  // These 4 fields are shared between the summary row (clicking a chip seeds them back in for
  // editing) and their matching "Add" panel below -- everything else a panel needs is fully
  // local to that panel's own component.
  const [castSelect, setCastSelect] = useState(BuilderState.CAST_OPTIONS[0]);
  const [dmgSelect, setDmgSelect] = useState(BuilderState.DMG_OPTIONS[0]);
  const [castResType, setCastResType] = useState('energy');
  const [castResAmt, setCastResAmt] = useState('');

  // Removing this node (or navigating away entirely) while it was hovered/highlighted would
  // otherwise leave a stale highlight pointing at a node no longer in the tree.
  useEffect(() => () => {
    if (useBuilderStore.getState().highlightedNodeId === nodeId) setHighlightedNodeId(null);
    if (useBuilderStore.getState().hoveredFieldHighlight?.nodeId === nodeId) setHoveredFieldHighlight(null);
  }, [nodeId]);

  // Whole-node highlight -- summary row only, so it doesn't also light up while the mouse is
  // just over a specific cell or resting inside the open sub-panel's own inputs below.
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
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFieldMouseEnter={enterFieldHover}
        onFieldMouseLeave={leaveFieldHover}
        setCastSelect={setCastSelect}
        setDmgSelect={setDmgSelect}
        setCastResType={setCastResType}
        setCastResAmt={setCastResAmt}
      />

      {activeTrigger && (
        <tr onMouseEnter={() => enterFieldHover(activeTrigger)} onMouseLeave={leaveFieldHover}>
          <td colSpan={12} className="mech-detail-cell">
            {renderPanel()}
          </td>
        </tr>
      )}
    </tbody>
  );
};
