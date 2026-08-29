// src/components/builder/MechanicNodeCard.tsx
// Orchestrates one MechanicNode's row in the mech-table: owns which sub-panel (if any) is
// open, the handful of "add" fields that are shared between the summary row's click-to-edit
// chips and their matching sub-panel, and renders the summary row plus whichever panel is
// active. Each panel's own fields (effects array, cancel timings, hit breakdown, etc.) are
// fully self-contained in their own component under ./panels -- see there to edit one.
import React, { useState, useRef } from 'react';
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

interface MechanicNodeCardProps {
  nodeId: string;
  data: MechanicNode;
}

export type PanelKey = 'identity' | 'inputs' | 'timeMods' | 'hits' | 'castTags' | 'dmgTags' | 'castRes' | 'default';

export const MechanicNodeCard: React.FC<MechanicNodeCardProps> = ({ nodeId, data }) => {
  const { setMechanicNode, removeMechanicNode, activeChar, baseStats, setHighlightedNodeId } = useBuilderStore();
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Which column's sub-panel is open, if any -- exactly one at a time, mirroring the rotation
  // table's activeTrigger/SubPanel pattern instead of a floating popover.
  const [activeTrigger, setActiveTrigger] = useState<PanelKey | null>(null);
  const toggleTrigger = (key: PanelKey) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveTrigger(prev => (prev === key ? null : key));
  };

  // These 4 fields are shared between the summary row (clicking a chip seeds them back in for
  // editing) and their matching "Add" panel below -- everything else a panel needs is fully
  // local to that panel's own component.
  const [castSelect, setCastSelect] = useState(BuilderState.CAST_OPTIONS[0]);
  const [dmgSelect, setDmgSelect] = useState(BuilderState.DMG_OPTIONS[0]);
  const [castResType, setCastResType] = useState('energy');
  const [castResAmt, setCastResAmt] = useState('');

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
  const forteOptions: React.ReactElement[] = [];
  for (let i = 1; i <= forteCount; i++) {
    forteOptions.push(<option key={i} value={`forte${i}`}>Forte {i}</option>);
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
        return <HitBreakdownPanel nodeId={nodeId} data={data} updateNode={updateNode} />;
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
        setCastSelect={setCastSelect}
        setDmgSelect={setDmgSelect}
        setCastResType={setCastResType}
        setCastResAmt={setCastResAmt}
      />

      {activeTrigger && (
        <tr>
          <td colSpan={12} className="mech-detail-cell">
            {renderPanel()}
          </td>
        </tr>
      )}
    </tbody>
  );
};
