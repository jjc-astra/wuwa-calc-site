// src/components/builder/panels/TriggerRuleEffectsPanel.tsx
import React, { useState } from 'react';
import type { Effect, MechanicNode } from '../../../types';
import { BuilderState } from '../../../data/db';
import { useBuilderStore } from '../../../store/useBuilderStore';
import { AutocompleteInput } from '../../common/AutocompleteInput';
import { TypeTag } from '../../common/TypeTag';
import { Dropdown, type DropdownOption } from '../../common/Dropdown';
import { parseTimeInput } from '../../../utils/Frames';
import { effectLabel, flattenDslShorthand } from '../mechanicNodeHelpers';

// Mirrors old site's makeInput/makeSelect wrapper: each field gets its own labeled,
// min-width flex slot so fields share row space instead of one 100%-width input swallowing others.
const EffField: React.FC<{ label: string; minWidth: number; children: React.ReactNode }> = ({ label, minWidth, children }) => (
  <div className="form-group flex-1" style={{ minWidth: `${minWidth}px`, margin: 0 }}>
    <label className="form-label text-dim">{label}</label>
    {children}
  </div>
);

interface TriggerRuleEffectsPanelProps {
  data: MechanicNode;
  updateNode: (patch: Partial<MechanicNode>) => void;
  forteOptions: DropdownOption[];
}

export const TriggerRuleEffectsPanel: React.FC<TriggerRuleEffectsPanelProps> = ({ data, updateNode, forteOptions }) => {
  const { baseStats } = useBuilderStore();
  const isDualMode = !!baseStats.isDualMode;
  const mode1Label = baseStats.mode1Name || 'Mode 1';
  const mode2Label = baseStats.mode2Name || 'Mode 2';
  const [effectType, setEffectType] = useState<string>('buff');

  // Effect Input State
  const [effName, setEffName] = useState('');
  const [effTarget, setEffTarget] = useState('@Self');
  const [effApplyTo, setEffApplyTo] = useState('');
  const [effStat, setEffStat] = useState('');
  const [effVal, setEffVal] = useState('');
  const [effStacks, setEffStacks] = useState('1');
  const [effMax, setEffMax] = useState('');
  const [effDur, setEffDur] = useState('');
  const [effStackBeh, setEffStackBeh] = useState<'resettable' | 'separate'>('resettable');
  const [effExpBeh, setEffExpBeh] = useState<'clear' | 'drop_one' | 'drop_half'>('clear');
  const [effRemSwap, setEffRemSwap] = useState(false);
  const [effAction, setEffAction] = useState('add');
  const [effTargetKind, setEffTargetKind] = useState<'buff' | 'cooldown'>('buff');

  const handleAddEffect = () => {
    const newEff: Effect = { type: effectType as any, name: flattenDslShorthand(effName.trim()) };
    if (effTarget && effTarget !== '@Self') newEff.target = effTarget;

    if (effectType === 'buff') {
      if (effApplyTo) newEff.applyTo = effApplyTo.split(',').map(s => s.trim()).filter(Boolean);
      if (effStat) newEff.stat = effStat;
      if (effVal) {
        const n = parseFloat(effVal);
        newEff.value = !isNaN(n) && n.toString() === effVal ? n : effVal;
      }
      if (effStacks && parseInt(effStacks, 10) !== 1) newEff.stacks = parseInt(effStacks, 10);
      // Buff lifetimes stay seconds -- "30f"/"0.5s"/a bare number (seconds) all accepted.
      if (effDur) newEff.duration = parseTimeInput(effDur, 'seconds');
      if (effMax) newEff.maxStacks = parseInt(effMax, 10);
      if (effStackBeh === 'separate') newEff.stackBehavior = effStackBeh;
      if (effExpBeh && effExpBeh !== 'clear') newEff.expireBehavior = effExpBeh;
      if (effRemSwap) newEff.removeOnSwap = true;
    } else if (effectType === 'buffAction' && effTargetKind === 'cooldown') {
      newEff.type = 'cooldown' as any;
      if (effAction === 'reset') {
        newEff.value = 0;
      } else {
        const amt = effVal.trim().replace(/^\+/, '');
        const sign = amt.startsWith('-') ? '-' : '+';
        const amtAbs = amt.replace(/^-/, '') || '0';
        newEff.value = `@Self.Cooldown(${effName.trim()}) ${sign} (${amtAbs})`;
      }
    } else if (effectType === 'tracker' || effectType === 'buffAction') {
      newEff.action = effAction as any;
      if (effVal) {
        const n = parseFloat(effVal);
        newEff.value = !isNaN(n) && n.toString() === effVal ? n : effVal;
      }
      if (effectType === 'tracker' && effMax) newEff.max = parseInt(effMax, 10);
    } else if (effectType === 'resource' || effectType === 'time_scale') {
      if (effVal) {
        const n = parseFloat(effVal);
        newEff.value = !isNaN(n) && n.toString() === effVal ? n : effVal;
      }
      if (effectType === 'time_scale' && effDur) newEff.duration = parseTimeInput(effDur, 'seconds');
    }

    const effects = [...(data.effects || []), newEff];
    updateNode({ effects });

    setEffName('');
    setEffTarget('@Self');
    setEffApplyTo('');
    setEffStat('');
    setEffVal('');
    setEffStacks('1');
    setEffMax('');
    setEffDur('');
    setEffRemSwap(false);
  };

  const loadEffectForEdit = (eff: Effect, idx: number) => {
    if (eff.type === 'cooldown') {
      // Reuses the Buff/CD Control panel -- reverse-derive the Action Type/Value the panel
      // itself generates (@Self.Cooldown(Name) +/- (Amount), or a flat 0 for Reset) so editing
      // round-trips. A hand-written value that doesn't match either shape is shown as-is under
      // Extend/Shorten, since there's no other action to bucket it under.
      setEffectType('buffAction');
      setEffTargetKind('cooldown');
      setEffName(eff.name || '');
      setEffTarget(eff.target || '@Self');
      const val = eff.value;
      const match = typeof val === 'string' ? val.match(/^@Self\.Cooldown\([^)]*\)\s*([+-])\s*\(([^)]*)\)$/) : null;
      if (match) {
        setEffAction('extend');
        setEffVal((match[1] === '-' ? '-' : '') + match[2].trim());
      } else if (val === 0 || val === '0') {
        setEffAction('reset');
        setEffVal('');
      } else {
        setEffAction('extend');
        setEffVal(val !== undefined ? String(val) : '');
      }
    } else {
      setEffectType(eff.type || 'buff');
      setEffTargetKind('buff');
      setEffName(eff.name || '');
      setEffTarget(eff.target || '@Self');
      setEffApplyTo(Array.isArray(eff.applyTo) ? eff.applyTo.join(', ') : (eff.applyTo as any) || '');
      setEffStat(eff.stat || '');
      setEffVal(eff.value !== undefined ? String(eff.value) : '');
      setEffStacks(eff.stacks !== undefined ? String(eff.stacks) : '1');
      setEffMax(eff.maxStacks !== undefined ? String(eff.maxStacks) : (eff.max !== undefined ? String(eff.max) : ''));
      setEffDur(eff.duration !== undefined ? String(eff.duration) : '');
      setEffStackBeh((eff.stackBehavior as any) || 'resettable');
      setEffExpBeh((eff.expireBehavior as any) || 'clear');
      setEffRemSwap(!!eff.removeOnSwap);
      setEffAction((eff.action as any) || 'add');
    }
    updateNode({ effects: data.effects?.filter((_, i) => i !== idx) });
  };

  return (
    <div className="sub-panel is-open">
      <div className="panel-header-main">Trigger Rule &amp; Effects</div>
      <div className="form-row">
        <div className="form-group flex-1">
          <label className="form-label">Trigger Rule (DSL)</label>
          <AutocompleteInput mode="general" value={data.triggerRule || ''} onValueChange={val => updateNode({ triggerRule: val })} placeholder="e.g. IF (@Self.Energy > 50)" />
        </div>
      </div>
      <div className="flags-row m-0">
        <label className="checkbox-label">
          <input type="checkbox" checked={!!data.isPassive} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ isPassive: e.target.checked })} />
          <span>Passive</span>
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={!!data.isSwapInDefault} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateNode({ isSwapInDefault: e.target.checked })} />
          <span>Default Swap-In</span>
        </label>
        {isDualMode && (
          <div className="segmented-toggle" role="group" aria-label="Mode scope">
            <button
              type="button"
              className={`segmented-toggle-btn ${!data.modeScope || data.modeScope === 'both' ? 'is-active' : ''}`}
              onClick={() => updateNode({ modeScope: 'both' })}
            >
              Both
            </button>
            <button
              type="button"
              className={`segmented-toggle-btn ${data.modeScope === 'mode1' ? 'is-active' : ''}`}
              onClick={() => updateNode({ modeScope: 'mode1' })}
            >
              {mode1Label}
            </button>
            <button
              type="button"
              className={`segmented-toggle-btn ${data.modeScope === 'mode2' ? 'is-active' : ''}`}
              onClick={() => updateNode({ modeScope: 'mode2' })}
            >
              {mode2Label}
            </button>
          </div>
        )}
      </div>

      <div className="panel-header-tiny" style={{ marginTop: '14px' }}>Effects Array</div>
      <div className="type-tag-container mech-effects-container mb-4px">
        {(data.effects || []).map((eff, idx) => (
          <TypeTag
            key={idx}
            val={JSON.stringify(eff)}
            label={effectLabel(eff)}
            onClick={() => loadEffectForEdit(eff, idx)}
            onRemove={() => updateNode({ effects: data.effects?.filter((_, i) => i !== idx) })}
          />
        ))}
      </div>

      <div className="flex-col gap-sm mt-4px w-100">
        <div className="flex-row gap-sm w-100 align-start">
          <Dropdown
            className="base-select w-105px"
            value={effectType}
            onChange={setEffectType}
            options={[
              { value: 'buff', label: 'Buff' },
              { value: 'buffAction', label: 'Buff/CD Control' },
              { value: 'resource', label: 'Resource' },
              { value: 'tracker', label: 'Tracker' },
              { value: 'time_scale', label: 'Time Scale' }
            ]}
          />

          {/* min-width: 0 overrides the flex item's default min-width: auto (which sizes to fit
              long unwrapped values like @Namespace(Move) refs) so flex-wrap kicks in instead of overflowing. */}
          <div className="flex-col gap-sm flex-1 flex-wrap" style={{ minWidth: 0 }}>
            {effectType === 'buff' && (
              <>
                <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                  <EffField label="Effect ID" minWidth={90}>
                    <AutocompleteInput mode="eff-name" value={effName} onValueChange={setEffName} placeholder="e.g. Fusion Burst" />
                  </EffField>
                  <EffField label="Target Entity" minWidth={90}>
                    <AutocompleteInput mode="eff-target" value={effTarget} onValueChange={setEffTarget} />
                  </EffField>
                  <EffField label="Applies During" minWidth={90}>
                    <AutocompleteInput mode="eff-applies-during" value={effApplyTo} onValueChange={setEffApplyTo} placeholder="e.g. Basic, @Lumi(Pounce)" />
                  </EffField>
                </div>

                <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                  <EffField label="Stat Modifier" minWidth={90}>
                    <AutocompleteInput mode="eff-stat" value={effStat} onValueChange={setEffStat} placeholder="e.g. reduceDef" statOptions={BuilderState.STAT_OPTIONS} dmgOptions={BuilderState.DMG_OPTIONS} />
                  </EffField>
                  <EffField label="Stat Value" minWidth={90}>
                    <input type="text" className="form-input w-100" value={effVal} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEffVal(e.target.value)} placeholder="e.g. 5% or 0.2" />
                  </EffField>
                  <EffField label="Stacks Applied" minWidth={90}>
                    <input type="number" step="1" className="form-input w-100" value={effStacks} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEffStacks(e.target.value)} placeholder="1" />
                  </EffField>
                  <EffField label="Max Stacks Cap" minWidth={90}>
                    <input type="number" step="1" className="form-input w-100" value={effMax} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEffMax(e.target.value)} placeholder="Limit" />
                  </EffField>
                </div>

                <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                  <EffField label="Duration (s)" minWidth={90}>
                    <input type="number" step="0.1" className="form-input w-100" value={effDur} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEffDur(e.target.value)} placeholder="Time" />
                  </EffField>
                  <EffField label="Stack Logic" minWidth={100}>
                    <Dropdown
                      className="base-select w-100"
                      value={effStackBeh}
                      onChange={v => setEffStackBeh(v as any)}
                      options={[
                        { value: 'resettable', label: 'Refresh Timers' },
                        { value: 'separate', label: 'Separate Timers' }
                      ]}
                    />
                  </EffField>
                  <EffField label="On Expiration" minWidth={100}>
                    <Dropdown
                      className="base-select w-100"
                      value={effExpBeh}
                      onChange={v => setEffExpBeh(v as any)}
                      options={[
                        { value: 'clear', label: 'Clear All' },
                        { value: 'drop_one', label: 'Drop 1 Stack' },
                        { value: 'drop_half', label: 'Drop Half' }
                      ]}
                    />
                  </EffField>
                  <div className="form-group flex-1" style={{ minWidth: '130px', margin: 0 }}>
                    <label className="form-label text-dim" style={{ opacity: 0, marginBottom: '2px', height: '14px' }}>_</label>
                    <label className="toolbar-toggle-label w-100" style={{ margin: 0, height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>
                      <input type="checkbox" checked={effRemSwap} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEffRemSwap(e.target.checked)} />
                      <span>Clear on Swap</span>
                    </label>
                  </div>
                </div>
              </>
            )}

            {effectType === 'tracker' && (
              <>
                <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                  <EffField label="Tracker ID" minWidth={90}>
                    <AutocompleteInput mode="eff-name" value={effName} onValueChange={setEffName} placeholder="e.g. Bullets" />
                  </EffField>
                  <EffField label="Action Type" minWidth={100}>
                    <Dropdown
                      className="base-select w-100"
                      value={effAction}
                      onChange={setEffAction}
                      options={[
                        { value: 'add', label: 'Add (+/-)' },
                        { value: 'set', label: 'Set (=)' },
                        { value: 'consume', label: 'Consume (Zero)' },
                        { value: 'detonate', label: 'Detonate' }
                      ]}
                    />
                  </EffField>
                </div>
                <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                  <EffField label="Tracker Value" minWidth={90}>
                    <input type="text" className="form-input w-100" value={effVal} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEffVal(e.target.value)} placeholder="Amount" />
                  </EffField>
                  <EffField label="Max Stacks Cap" minWidth={90}>
                    <input type="number" step="1" className="form-input w-100" value={effMax} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEffMax(e.target.value)} placeholder="Limit" />
                  </EffField>
                </div>
              </>
            )}

            {effectType === 'buffAction' && (
              <>
                <div className="flex-row w-100 gap-sm m-0 flex-wrap align-start">
                  <div className="form-group" style={{ flex: '0 0 auto', minWidth: 0, margin: 0 }}>
                    <label className="form-label text-dim">Target Kind</label>
                    <div className="segmented-toggle" role="group" aria-label="Buff/CD target kind">
                      <button
                        type="button"
                        className={`segmented-toggle-btn ${effTargetKind === 'buff' ? 'is-active' : ''}`}
                        onClick={() => { setEffTargetKind('buff'); setEffAction('remove'); }}
                      >
                        Buff
                      </button>
                      <button
                        type="button"
                        className={`segmented-toggle-btn ${effTargetKind === 'cooldown' ? 'is-active' : ''}`}
                        onClick={() => { setEffTargetKind('cooldown'); setEffAction('extend'); }}
                      >
                        Cooldown
                      </button>
                    </div>
                  </div>
                  <EffField label={effTargetKind === 'cooldown' ? 'Target Mechanic' : 'Target Effect ID'} minWidth={90}>
                    {effTargetKind === 'cooldown'
                      ? <AutocompleteInput mode="eff-cd-name" value={effName} onValueChange={setEffName} placeholder="e.g. Resonance Skill" />
                      : <AutocompleteInput mode="eff-name" value={effName} onValueChange={setEffName} placeholder="e.g. Fusion Burst" />}
                  </EffField>
                  <EffField label="Target Entity" minWidth={90}>
                    <AutocompleteInput mode="eff-target" value={effTarget} onValueChange={setEffTarget} />
                  </EffField>
                </div>
                <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                  <EffField label="Action Type" minWidth={100}>
                    <Dropdown
                      className="base-select w-100"
                      value={effAction}
                      onChange={setEffAction}
                      options={effTargetKind === 'cooldown' ? [
                        { value: 'extend', label: 'Extend/Shorten Time' },
                        { value: 'reset', label: 'Reset (Ready Now)' }
                      ] : [
                        { value: 'remove', label: 'Remove / Consume' },
                        { value: 'pause', label: 'Pause Timer' },
                        { value: 'resume', label: 'Resume Timer' },
                        { value: 'extend', label: 'Extend/Shorten Time' }
                      ]}
                    />
                  </EffField>
                  {!(effTargetKind === 'cooldown' && effAction === 'reset') && (
                    <EffField label="Action Value" minWidth={90}>
                      <input
                        type="text"
                        className="form-input w-100"
                        value={effVal}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEffVal(e.target.value)}
                        placeholder={effTargetKind === 'cooldown' ? 'Seconds, e.g. 5 or -5' : 'ALL, HALF, or Num'}
                      />
                    </EffField>
                  )}
                </div>
              </>
            )}

            {effectType === 'resource' && (
              <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                <EffField label="Resource Type" minWidth={100}>
                  <Dropdown
                    className="base-select w-100"
                    value={effName}
                    onChange={setEffName}
                    options={[
                      { value: 'energy', label: 'Energy' },
                      { value: 'concerto', label: 'Concerto' },
                      ...forteOptions,
                      { value: 'tune', label: 'Tune' }
                    ]}
                  />
                </EffField>
                <EffField label="Resource Value" minWidth={90}>
                  <input type="text" className="form-input w-100" value={effVal} onChange={e => setEffVal(e.target.value)} placeholder="Amount (e.g. 10 or -5)" />
                </EffField>
              </div>
            )}

            {effectType === 'time_scale' && (
              <>
                <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                  <EffField label="Timer / Buff ID" minWidth={90}>
                    <AutocompleteInput mode="eff-name" value={effName} onValueChange={setEffName} placeholder="Specific ID or ALL" />
                  </EffField>
                  <EffField label="Target Entity" minWidth={90}>
                    <AutocompleteInput mode="eff-target" value={effTarget} onValueChange={setEffTarget} />
                  </EffField>
                </div>
                <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                  <EffField label="Time Speed / Scale" minWidth={90}>
                    <input type="text" className="form-input w-100" value={effVal} onChange={e => setEffVal(e.target.value)} placeholder="-50% (Fast) / 50% (Slow)" />
                  </EffField>
                  <EffField label="Duration (s)" minWidth={90}>
                    <input type="number" step="0.1" className="form-input w-100" value={effDur} onChange={e => setEffDur(e.target.value)} placeholder="Time" />
                  </EffField>
                </div>
              </>
            )}
          </div>

          <button type="button" className="base-btn icon-btn icon-btn-sm align-self-start" onClick={handleAddEffect}>
            +
          </button>
        </div>
      </div>
    </div>
  );
};
