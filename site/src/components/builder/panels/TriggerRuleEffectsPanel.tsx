// src/components/builder/panels/TriggerRuleEffectsPanel.tsx
import React, { useState } from 'react';
import type { Effect, MechanicNode } from '../../../types';
import { BuilderState } from '../../../data/db';
import { useBuilderStore } from '../../../store/useBuilderStore';
import { AutocompleteInput } from '../../common/AutocompleteInput';
import { SegmentedToggle } from '../../common/SegmentedToggle';
import { TypeTag } from '../../common/TypeTag';
import { Dropdown, type DropdownOption } from '../../common/Dropdown';
import { parseTimeInput } from '../../../utils/Frames';
import { effectLabel, flattenDslShorthand } from '../mechanicNodeHelpers';
import { MechanicKey } from '../../../utils/MechanicKey';

// Mirrors old site's makeInput/makeSelect wrapper: each field gets its own labeled,
// min-width flex slot so fields share row space instead of one 100%-width input swallowing others.
const EffField: React.FC<{ label: string; minWidth: number; children: React.ReactNode }> = ({ label, minWidth, children }) => (
  <div className="form-group flex-1" style={{ minWidth: `${minWidth / 16}rem`, margin: 0 }}>
    <label className="form-label caps-label text-dim">{label}</label>
    {children}
  </div>
);

interface FieldProps {
  label: string;
  minWidth?: number;
}

const TextField: React.FC<FieldProps & { value: string; onChange: (value: string) => void; placeholder?: string; type?: 'text' | 'number'; step?: string }> = (
  { label, minWidth = 90, value, onChange, placeholder, type = 'text', step }
) => (
  <EffField label={label} minWidth={minWidth}>
    <input type={type} step={step} className="form-input w-100" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
  </EffField>
);

const AutoField: React.FC<FieldProps & Omit<React.ComponentProps<typeof AutocompleteInput>, 'onValueChange' | 'onChange'> & { onChange: (value: string) => void }> = (
  { label, minWidth = 90, onChange, ...inputProps }
) => (
  <EffField label={label} minWidth={minWidth}>
    <AutocompleteInput {...inputProps} onValueChange={onChange} />
  </EffField>
);

const SelectField: React.FC<FieldProps & { value: string; onChange: (value: string) => void; options: DropdownOption[] }> = (
  { label, minWidth = 100, value, onChange, options }
) => (
  <EffField label={label} minWidth={minWidth}>
    <Dropdown className="base-select w-100" value={value} onChange={onChange} options={options} />
  </EffField>
);

// The effect being composed at the bottom of the panel, before it's added to the node's effects.
interface EffectDraft {
  type: string;
  name: string;
  target: string;
  applyTo: string;
  stat: string;
  val: string;
  stacks: string;
  max: string;
  dur: string;
  stackBeh: 'resettable' | 'separate';
  expBeh: 'clear' | 'drop_one' | 'drop_half';
  remSwap: boolean;
  action: string;
  targetKind: 'buff' | 'cooldown';
}

type TextDraftKey = 'name' | 'target' | 'applyTo' | 'stat' | 'val' | 'stacks' | 'max' | 'dur';

const BLANK_DRAFT: EffectDraft = {
  type: 'buff', name: '', target: '@Self', applyTo: '', stat: '', val: '', stacks: '1', max: '', dur: '',
  stackBeh: 'resettable', expBeh: 'clear', remSwap: false, action: 'add', targetKind: 'buff'
};

// A numeric string stays a string unless it round-trips exactly ("5" -> 5, "5%" or "05" stay text).
const numberIfExact = (text: string): number | string => {
  const n = parseFloat(text);
  return !isNaN(n) && n.toString() === text ? n : text;
};

interface TriggerRuleEffectsPanelProps {
  data: MechanicNode;
  updateNode: (patch: Partial<MechanicNode>) => void;
  forteOptions: DropdownOption[];
  groupSiblings?: { repeat?: [string, MechanicNode]; release?: [string, MechanicNode] };
  nodeId?: string;
}

export const TriggerRuleEffectsPanel: React.FC<TriggerRuleEffectsPanelProps> = ({ data, updateNode, forteOptions, groupSiblings, nodeId }) => {
  const { baseStats, activeChar, setMechanicNode, removeMechanicNode } = useBuilderStore();
  const isDualMode = !!baseStats.isDualMode;
  const mode1Label = baseStats.mode1Name || 'Mode 1';
  const mode2Label = baseStats.mode2Name || 'Mode 2';

  const [draft, setDraft] = useState<EffectDraft>(BLANK_DRAFT);
  const set = (patch: Partial<EffectDraft>) => setDraft(d => ({ ...d, ...patch }));
  // Props wiring a text-valued draft field to a field component.
  const bind = (key: TextDraftKey) => ({ value: draft[key], onChange: (value: string) => set({ [key]: value }) });

  const provider = activeChar || 'System';
  const existingRepeatId = groupSiblings?.repeat?.[0];
  const existingReleaseId = groupSiblings?.release?.[0];
  const hasRepeat = data.inputType === 'Hold' && !!existingRepeatId;
  const hasRelease = data.inputType === 'Hold' && !!existingReleaseId;

  const toggleHoldSibling = (role: 'Repeat' | 'Release', checked: boolean) => {
    const existingId = role === 'Repeat' ? existingRepeatId : existingReleaseId;
    if (!checked) {
      if (existingId) removeMechanicNode(existingId);
      return;
    }
    if (existingId) return;
    const holdGroupId = data.holdGroupId || crypto.randomUUID();
    if (!data.holdGroupId) updateNode({ holdGroupId });
    // Clears stale cursor settings on existing Release siblings when adding a Repeat, stamping holdGroupId to prevent node orphaning.
    if (role === 'Repeat' && existingReleaseId && groupSiblings?.release?.[1]) {
      const [releaseId, releaseData] = groupSiblings.release;
      const { holdConfig, ...releaseRest } = releaseData;
      setMechanicNode(releaseId, { ...releaseRest, holdGroupId } as MechanicNode);
    }
    // Brand new sibling -- name it off the Hold's own name, since nothing to reuse yet.
    const id = MechanicKey.build(provider, `${data.name} (${role})`);
    // Inserts the node contiguous with its Hold group in the JSON (after Repeat if present, else after Hold).
    const insertAfter = (role === 'Release' && existingRepeatId) || nodeId;
    setMechanicNode(id, {
      name: `${data.name} (${role})`,
      category: data.category,
      provider,
      input: data.input,
      inputType: role,
      holdGroupId,
      isPassive: false
    } as MechanicNode, insertAfter);
  };

  const handleAddEffect = () => {
    const { type, name, target, applyTo, stat, val, stacks, max, dur, stackBeh, expBeh, remSwap, action, targetKind } = draft;
    const newEff: Effect = { type: type as any, name: flattenDslShorthand(name.trim()) };
    if (target && target !== '@Self') newEff.target = target;

    if (type === 'buff') {
      if (applyTo) newEff.applyTo = applyTo.split(',').map(s => s.trim()).filter(Boolean);
      if (stat) newEff.stat = stat;
      if (val) newEff.value = numberIfExact(val);
      if (stacks && parseInt(stacks, 10) !== 1) newEff.stacks = parseInt(stacks, 10);
      // Buff lifetimes stay seconds -- "30f"/"0.5s"/a bare number (seconds) all accepted.
      if (dur) newEff.duration = parseTimeInput(dur, 'seconds');
      if (max) {
        const n = parseInt(max, 10);
        newEff.maxStacks = !isNaN(n) && n.toString() === max.trim() ? n : max;
      }
      if (stackBeh === 'separate') newEff.stackBehavior = stackBeh;
      if (expBeh && expBeh !== 'clear') newEff.expireBehavior = expBeh;
      if (remSwap) newEff.removeOnSwap = true;
    } else if (type === 'buffAction' && targetKind === 'cooldown') {
      newEff.type = 'cooldown' as any;
      if (action === 'reset') {
        newEff.value = 0;
      } else {
        const amt = val.trim().replace(/^\+/, '');
        const sign = amt.startsWith('-') ? '-' : '+';
        const amtAbs = amt.replace(/^-/, '') || '0';
        newEff.value = `@Self.Cooldown(${name.trim()}) ${sign} (${amtAbs})`;
      }
    } else if (type === 'tracker' || type === 'buffAction') {
      newEff.action = action as any;
      // Delete ignores value/max in TimelineEngine; omitting stale amounts keeps the JSON clean.
      if (action !== 'delete') {
        if (val) newEff.value = numberIfExact(val);
        if (type === 'tracker' && max) newEff.max = parseInt(max, 10);
      }
    } else if (type === 'resource' || type === 'time_scale') {
      if (val) newEff.value = numberIfExact(val);
      if (type === 'time_scale' && dur) newEff.duration = parseTimeInput(dur, 'seconds');
    }

    updateNode({ effects: [...(data.effects || []), newEff] });

    // Ready for the next effect of the same kind: the behavior/action/kind choices stay put.
    set({
      name: BLANK_DRAFT.name, target: BLANK_DRAFT.target, applyTo: BLANK_DRAFT.applyTo, stat: BLANK_DRAFT.stat,
      val: BLANK_DRAFT.val, stacks: BLANK_DRAFT.stacks, max: BLANK_DRAFT.max, dur: BLANK_DRAFT.dur, remSwap: BLANK_DRAFT.remSwap
    });
  };

  const loadEffectForEdit = (eff: Effect, idx: number) => {
    if (eff.type === 'cooldown') {
      // Reuses the Buff/CD Control panel -- reverse-derive the Action Type/Value the panel
      // itself generates (@Self.Cooldown(Name) +/- (Amount), or a flat 0 for Reset) so editing
      // round-trips. A hand-written value that doesn't match either shape is shown as-is under
      // Extend/Shorten, since there's no other action to bucket it under.
      const val = eff.value;
      const match = typeof val === 'string' ? val.match(/^@Self\.Cooldown\([^)]*\)\s*([+-])\s*\(([^)]*)\)$/) : null;
      const cooldown: Partial<EffectDraft> = { type: 'buffAction', targetKind: 'cooldown', name: eff.name || '', target: eff.target || '@Self' };
      if (match) {
        set({ ...cooldown, action: 'extend', val: (match[1] === '-' ? '-' : '') + match[2].trim() });
      } else if (val === 0 || val === '0') {
        set({ ...cooldown, action: 'reset', val: '' });
      } else {
        set({ ...cooldown, action: 'extend', val: val !== undefined ? String(val) : '' });
      }
    } else {
      set({
        type: eff.type || 'buff',
        targetKind: 'buff',
        name: eff.name || '',
        target: eff.target || '@Self',
        applyTo: Array.isArray(eff.applyTo) ? eff.applyTo.join(', ') : (eff.applyTo as any) || '',
        stat: eff.stat || '',
        val: eff.value !== undefined ? String(eff.value) : '',
        stacks: eff.stacks !== undefined ? String(eff.stacks) : '1',
        max: eff.maxStacks !== undefined ? String(eff.maxStacks) : (eff.max !== undefined ? String(eff.max) : ''),
        dur: eff.duration !== undefined ? String(eff.duration) : '',
        stackBeh: (eff.stackBehavior as any) || 'resettable',
        expBeh: (eff.expireBehavior as any) || 'clear',
        remSwap: !!eff.removeOnSwap,
        action: (eff.action as any) || 'add'
      });
    }
    updateNode({ effects: data.effects?.filter((_, i) => i !== idx) });
  };

  const { type: effectType, action: effAction, targetKind: effTargetKind } = draft;

  return (
    <div className="sub-panel is-open">
      <div className="panel-header-main">Trigger Rule &amp; Effects</div>
      <div className="form-row">
        <div className="form-group flex-1">
          <label className="form-label caps-label">Trigger Rule (DSL)</label>
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
        {data.inputType === 'Hold' && (
          <>
            <label className="checkbox-label">
              <input type="checkbox" checked={hasRepeat} onChange={e => toggleHoldSibling('Repeat', e.target.checked)} />
              <span>Add Repeat</span>
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={hasRelease} onChange={e => toggleHoldSibling('Release', e.target.checked)} />
              <span>Add Release</span>
            </label>
          </>
        )}
        {isDualMode && (
          <SegmentedToggle
            ariaLabel="Mode scope"
            value={data.modeScope || 'both'}
            onChange={modeScope => updateNode({ modeScope })}
            options={[
              { value: 'both', label: 'Both' },
              { value: 'mode1', label: mode1Label },
              { value: 'mode2', label: mode2Label }
            ]}
          />
        )}
      </div>

      <div className="panel-header-tiny" style={{ marginTop: '0.875rem' }}>Effects Array</div>
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
            onChange={type => set({ type })}
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
                  <AutoField label="Effect ID" mode="eff-name" {...bind('name')} placeholder="e.g. Fusion Burst" />
                  <AutoField label="Target Entity" mode="eff-target" {...bind('target')} />
                  <AutoField label="Applies During" mode="eff-applies-during" {...bind('applyTo')} placeholder="e.g. Basic, @Lumi(Pounce)" />
                </div>

                <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                  <AutoField label="Stat Modifier" mode="eff-stat" {...bind('stat')} placeholder="e.g. reduceDef" statOptions={BuilderState.STAT_OPTIONS} dmgOptions={BuilderState.DMG_OPTIONS} />
                  <TextField label="Stat Value" {...bind('val')} placeholder="e.g. 5% or 0.2" />
                  <TextField label="Stacks Applied" type="number" step="1" {...bind('stacks')} placeholder="1" />
                  <TextField label="Max Stacks Cap" {...bind('max')} placeholder="e.g. 10 or 10 + (@Self.HasBuff(X) * 3)" />
                </div>

                <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                  <TextField label="Duration (s)" type="number" step="0.1" {...bind('dur')} placeholder="Time" />
                  <SelectField
                    label="Stack Logic"
                    value={draft.stackBeh}
                    onChange={v => set({ stackBeh: v as EffectDraft['stackBeh'] })}
                    options={[
                      { value: 'resettable', label: 'Refresh Timers' },
                      { value: 'separate', label: 'Separate Timers' }
                    ]}
                  />
                  <SelectField
                    label="On Expiration"
                    value={draft.expBeh}
                    onChange={v => set({ expBeh: v as EffectDraft['expBeh'] })}
                    options={[
                      { value: 'clear', label: 'Clear All' },
                      { value: 'drop_one', label: 'Drop 1 Stack' },
                      { value: 'drop_half', label: 'Drop Half' }
                    ]}
                  />
                  <div className="form-group flex-1" style={{ minWidth: '8.125rem', margin: 0 }}>
                    <label className="form-label caps-label text-dim" style={{ opacity: 0, marginBottom: '2px', height: '0.875rem' }}>_</label>
                    <label className="toolbar-toggle-label w-100" style={{ margin: 0, height: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>
                      <input type="checkbox" checked={draft.remSwap} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set({ remSwap: e.target.checked })} />
                      <span>Clear on Swap</span>
                    </label>
                  </div>
                </div>
              </>
            )}

            {effectType === 'tracker' && (
              <>
                <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                  <AutoField label="Tracker ID" mode="eff-name" {...bind('name')} placeholder="e.g. Bullets" />
                  <SelectField
                    label="Action Type"
                    value={effAction}
                    onChange={action => set({ action })}
                    options={[
                      { value: 'add', label: 'Add (+/-)' },
                      { value: 'set', label: 'Set (=)' },
                      { value: 'consume', label: 'Consume (ALL/HALF/Num)' },
                      { value: 'detonate', label: 'Detonate' },
                      { value: 'delete', label: 'Delete (Unset)' }
                    ]}
                  />
                </div>
                {effAction !== 'delete' && (
                  <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                    <TextField
                      label="Tracker Value"
                      {...bind('val')}
                      placeholder={effAction === 'consume' ? 'ALL, HALF, or Num' : 'Amount or DSL, e.g. @Self.BuffStacks(Clarity)'}
                    />
                    <TextField label="Max Stacks Cap" type="number" step="1" {...bind('max')} placeholder="Limit" />
                  </div>
                )}
              </>
            )}

            {effectType === 'buffAction' && (
              <>
                <div className="flex-row w-100 gap-sm m-0 flex-wrap align-start">
                  <div className="form-group" style={{ flex: '0 0 auto', minWidth: 0, margin: 0 }}>
                    <label className="form-label caps-label text-dim">Target Kind</label>
                    <SegmentedToggle
                      ariaLabel="Buff/CD target kind"
                      value={effTargetKind}
                      onChange={kind => set({ targetKind: kind, action: kind === 'buff' ? 'remove' : 'extend' })}
                      options={[
                        { value: 'buff', label: 'Buff' },
                        { value: 'cooldown', label: 'Cooldown' }
                      ]}
                    />
                  </div>
                  {effTargetKind === 'cooldown'
                    ? <AutoField label="Target Mechanic" mode="eff-cd-name" {...bind('name')} placeholder="e.g. Resonance Skill" />
                    : <AutoField label="Target Effect ID" mode="eff-name" {...bind('name')} placeholder="e.g. Fusion Burst" />}
                  <AutoField label="Target Entity" mode="eff-target" {...bind('target')} />
                </div>
                <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                  <SelectField
                    label="Action Type"
                    value={effAction}
                    onChange={action => set({ action })}
                    options={effTargetKind === 'cooldown' ? [
                      { value: 'extend', label: 'Extend/Shorten Time' },
                      { value: 'reset', label: 'Reset (Ready Now)' }
                    ] : [
                      { value: 'remove', label: 'Remove' },
                      { value: 'consume', label: 'Consume' },
                      { value: 'pause', label: 'Pause Timer' },
                      { value: 'resume', label: 'Resume Timer' },
                      { value: 'extend', label: 'Extend/Shorten Time' }
                    ]}
                  />
                  {!(effTargetKind === 'cooldown' && effAction === 'reset') && (
                    <TextField
                      label="Action Value"
                      {...bind('val')}
                      placeholder={effTargetKind === 'cooldown' ? 'Seconds, e.g. 5 or -5' : 'ALL, HALF, or Num'}
                    />
                  )}
                </div>
              </>
            )}

            {effectType === 'resource' && (
              <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                <SelectField
                  label="Resource Type"
                  value={draft.name}
                  onChange={name => set({ name })}
                  options={[
                    { value: 'energy', label: 'Energy' },
                    { value: 'concerto', label: 'Concerto' },
                    ...forteOptions,
                    { value: 'tune', label: 'Tune' }
                  ]}
                />
                <TextField label="Resource Value" {...bind('val')} placeholder="Amount (e.g. 10 or -5)" />
              </div>
            )}

            {effectType === 'time_scale' && (
              <>
                <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                  <AutoField label="Timer / Buff ID" mode="eff-name" {...bind('name')} placeholder="Specific ID or ALL" />
                  <AutoField label="Target Entity" mode="eff-target" {...bind('target')} />
                </div>
                <div className="flex-row w-100 gap-sm m-0 flex-wrap">
                  <TextField label="Time Speed / Scale" {...bind('val')} placeholder="-50% (Fast) / 50% (Slow)" />
                  <TextField label="Duration (s)" type="number" step="0.1" {...bind('dur')} placeholder="Time" />
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
