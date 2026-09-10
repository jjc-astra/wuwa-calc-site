// One MechanicNode's row: owns which sub-panel is open, shared "add" fields between the
// summary row's chips and sub-panels, and renders the row + active panel.
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

// Fields each sub-panel edits, for JsonOutputPane's highlight.
// Keep in sync with each panel's own updateNode calls.
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
  // Single ref shared by every field-hover source, so a fast leave-then-enter across
  // adjacent targets cancels the pending clear instead of flickering (50ms debounce both ways).
  const fieldHoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Which sub-panel is open, if any -- one at a time (like the rotation table's activeTrigger).
  const [activeTrigger, setActiveTrigger] = useState<PanelKey | null>(null);
  const toggleTrigger = (key: PanelKey) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveTrigger(activeTrigger === key ? null : key);
  };

  // Previews a sub-panel's fields on hover (cell or open body) -- independent of highlightedNodeId.
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

  // Shared between summary row (chip click seeds these) and the matching "Add" panel.
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
        return <InputsPhysicsPanel data={data} updateNode={updateNode} forteOptions={forteOptions} />;
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
