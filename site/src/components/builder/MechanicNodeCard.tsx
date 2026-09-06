// Orchestrates one MechanicNode's row in the mech-table: owns which sub-panel is open, the
// "add" fields shared between the summary row's click-to-edit chips and their sub-panel, and
// renders the summary row plus whichever panel is active. Each panel is self-contained in
// its own component under ./panels.
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

// Which JSON fields each sub-panel edits, driving JsonOutputPane's field highlight. Keep in
// sync with each panel's own updateNode calls.
const PANEL_FIELDS: Record<PanelKey, string[]> = {
  identity: ['name', 'provider'],
  inputs: ['input', 'inputType', 'stanceReq', 'stanceResult', 'stanceTime', 'holdConfig'],
  timeMods: ['freezeTime', 'swapTiming', 'priority', 'comboWindow', 'cancelTimings'],
  hits: ['scalar', 'hitMults', 'damageTimeframe', 'hitResources'],
  castTags: ['castTypes'],
  dmgTags: ['dmgTypes'],
  castRes: ['castResources'],
  default: ['triggerRule', 'isPassive', 'isSwapInDefault', 'modeScope', 'effects']
};

export const MechanicNodeCard: React.FC<MechanicNodeCardProps> = ({ nodeId, data }) => {
  const { setMechanicNode, removeMechanicNode, activeChar, baseStats, setHighlightedNodeId, setHoveredFieldHighlight } = useBuilderStore();
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Single ref shared by every field-hover source, so a fast leave-then-enter across adjacent
  // hover targets cancels the pending "clear" instead of flashing the highlight off and back on.
  // Symmetric 50ms debounce on both enter and leave avoids that flicker.
  const fieldHoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Which column's sub-panel is open, if any -- exactly one at a time, like the rotation
  // table's activeTrigger/SubPanel pattern.
  const [activeTrigger, setActiveTrigger] = useState<PanelKey | null>(null);
  const toggleTrigger = (key: PanelKey) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveTrigger(activeTrigger === key ? null : key);
  };

  // Previews a sub-panel's edited fields on hover over its summary-row cell or its open body.
  // Independent of highlightedNodeId (whole-node, row-only).
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

  // Shared between the summary row (clicking a chip seeds these back in) and their matching
  // "Add" panel below.
  const [castSelect, setCastSelect] = useState(BuilderState.CAST_OPTIONS[0]);
  const [dmgSelect, setDmgSelect] = useState(BuilderState.DMG_OPTIONS[0]);
  const [castResType, setCastResType] = useState('energy');
  const [castResAmt, setCastResAmt] = useState('');

  // Removing this node while hovered/highlighted would otherwise leave a stale highlight.
  useEffect(() => () => {
    if (useBuilderStore.getState().highlightedNodeId === nodeId) setHighlightedNodeId(null);
    if (useBuilderStore.getState().hoveredFieldHighlight?.nodeId === nodeId) setHoveredFieldHighlight(null);
  }, [nodeId]);

  // Whole-node highlight, summary row only.
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

  // Checks live baseStats first, falls back to DB.
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
