import type { DSLPointerDef, DSLDataType } from './dslTypes';

// Single source of truth for the mechanics DSL's vocabulary: dslParser.ts derives its
// pointer/scalar translation tables from DSL_POINTERS, and AutocompleteInput.tsx (via
// dslResolver.ts) derives its suggestion lists from the same data.
//
// Most properties translate generically as `pointer.targetVar + '.' + targetKey`. Some don't --
// dslParser.ts historically hardcoded these as full literal substitutions, and several genuinely
// can't be generic:
//   - Prev/Next: the BARE pointer (`@Prev`, `@Next`) resolves to their "identity" property
//     (`ctx.prev.unit`, `ctx.next.name`), not a plain container -- so every OTHER property on
//     them (Action, CastTypes, Priority) must be its own full override, since deriving from the
//     bare targetVar would nest incorrectly (`ctx.prev.unit.action`).
//   - Enemy.Name compiles to the literal string `"Enemy"`, not a ctx field.
//   - Move.SwapTime targets `ctx.move.swapTiming` -- note the spelling differs from
//     Default.SwapTime's generic `.swapTime` suffix, so Move's properties can't fall back to the
//     generic suffix table without colliding with that name.
// Each such property carries `fullOverride` instead of `targetKey`.
export const DSL_EVENTS = [
  'ALWAYS', 'OnStart', 'OnCast', 'OnHit', 'AfterHit',
  'OnSwapIn', 'OnSwapOut', 'OnUnitChange', 'OnTick',
  'OnTrackerAdd', 'OnTrackerRemove', 'OnTrackerConsume', 'OnTrackerChanged', 'OnTrackerDetonate',
  'OnBuffAdd', 'OnBuffRemove', 'OnBuffConsume', 'OnBuffUpdate', 'OnBuffExpire'
] as const;

export const DSL_EVENT_TOOLTIPS: Record<string, string> = {
  ALWAYS: 'Evaluated continuously rather than tied to a specific event.',
  OnStart: 'Fires once at the start of the rotation.',
  OnCast: 'Fires the moment this move begins casting, before any hits land. Filter with [CastType], e.g. OnCast[Skill].',
  OnHit: 'Fires each time a hit connects. Filter with [CastType/Element/Status], e.g. OnHit[Skill].',
  AfterHit: 'Fires after a hit resolves, with an optional delay in seconds, e.g. AfterHit(0.5).',
  OnSwapIn: 'Fires when this character swaps onto the field.',
  OnSwapOut: 'Fires when this character swaps off the field.',
  OnUnitChange: 'Fires on a character swap, alongside OnSwapIn/OnSwapOut -- for effects tied to the active character changing rather than to either side of the swap specifically.',
  OnTick: 'Fires on each periodic tick of a duration-based effect, e.g. OnTick(1) for once per second.',
  OnTrackerAdd: 'Fires when a tracker/stack is added. Filter with [TrackerName].',
  OnTrackerRemove: 'Fires when a tracker/stack is removed. Filter with [TrackerName].',
  OnTrackerConsume: 'Fires when a tracker/stack is consumed. Filter with [TrackerName].',
  OnTrackerChanged: 'Fires whenever a tracker changes for any reason (add/remove/set/consume/delete). Filter with [TrackerName].',
  OnTrackerDetonate: 'Fires when a tracker is detonated via the detonate action. Filter with [TrackerName], e.g. OnTrackerDetonate[Spectro Frazzle].',
  OnBuffAdd: 'Fires when a buff is applied. Filter with [BuffName].',
  OnBuffRemove: 'Fires when a Buff/CD Control effect strips the buff via the Remove action (ALL/HALF/N, same options as Consume). Filter with [BuffName].',
  OnBuffConsume: "Fires when a Buff/CD Control effect spends the buff via the Consume action (ALL/HALF/N, same options as Remove) -- use it to distinguish the wearer spending their own buff from something else stripping it. Filter with [BuffName].",
  OnBuffUpdate: 'Fires when an existing buff is refreshed or its stacks change. Filter with [BuffName].',
  OnBuffExpire: 'Fires when a buff runs out on its own (duration reaches zero), as opposed to being explicitly removed or consumed. Filter with [BuffName].'
};

export const DSL_MODIFIERS = [
  'Self', 'Basic', 'Heavy', 'Skill', 'Liberation',
  'Intro', 'Outro', 'Coordinated', 'TuneBreak', 'TuneRupture', 'TuneHack',
  'Dodge', 'Jump', 'Echo', 'Utility', 'Heal',
  'Spectro', 'Fusion', 'Glacio', 'Aero', 'Electro', 'Havoc', 'Physical',
  'Defense', 'HP', 'ATK',
  'Spectro Frazzle', 'Aero Erosion', 'Electro Flare', 'Electro Rage', 'Fusion Burst', 'Glacio Chafe'
] as const;

export const DSL_MODIFIER_TOOLTIPS: Record<string, string> = {
  Self: 'Restricts the event to actions performed by this character.',
  Basic: 'Matches Basic Attacks.',
  Heavy: 'Matches Heavy Attacks (held/Forte attacks).',
  Skill: 'Matches Resonance Skill casts.',
  Liberation: 'Matches Resonance Liberation casts.',
  Intro: 'Matches Intro Skill casts.',
  Outro: 'Matches Outro Skill casts.',
  Coordinated: 'Matches Coordinated Attacks.',
  TuneBreak: 'Matches Tune Break hits.',
  TuneRupture: 'Matches Tune Rupture hits.',
  TuneHack: 'Matches Tune Hack hits.',
  Dodge: 'Matches Dodge-related actions (e.g. Dodge Counter).',
  Jump: 'Matches Jump-related actions.',
  Echo: 'Matches Echo skill casts.',
  Utility: 'Matches Utility skill casts.',
  Heal: 'Matches healing actions.',
  Spectro: 'Matches hits or effects of Spectro damage type.',
  Fusion: 'Matches hits or effects of Fusion damage type.',
  Glacio: 'Matches hits or effects of Glacio damage type.',
  Aero: 'Matches hits or effects of Aero damage type.',
  Electro: 'Matches hits or effects of Electro damage type.',
  Havoc: 'Matches hits or effects of Havoc damage type.',
  Physical: 'Matches hits or effects of Physical damage type.',
  Defense: 'Matches Defense-based effects.',
  HP: 'Matches HP-based effects.',
  ATK: 'Matches ATK-based effects.',
  'Spectro Frazzle': 'Matches the Spectro Frazzle status.',
  'Aero Erosion': 'Matches the Aero Erosion status.',
  'Electro Flare': 'Matches the Electro Flare status.',
  'Electro Rage': 'Matches the Electro Rage status.',
  'Fusion Burst': 'Matches the Fusion Burst status.',
  'Glacio Chafe': 'Matches the Glacio Chafe status.'
};

export const DSL_FUNCTIONS = ['StatusMult()'];
export const DSL_FUNCTION_TOOLTIPS: Record<string, string> = {
  'StatusMult()': 'Function — returns the negative-status damage multiplier for a given status and stack count, e.g. @StatusMult(Aero Erosion, @Self.Tracker(Stacks)).'
};

// Not DSL sugar -- these are raw JS methods that already work today because a compiled rule is
// just `new Function('ctx', 'equipper', 'return ' + jsStr)`. Any property that resolves to a real
// JS array/string already supports its native methods. Listed here purely so autocomplete can
// surface what's already usable -- doesn't drive any translation/evaluation logic.
export const DSL_TYPE_METHODS: Record<DSLDataType, Array<{ name: string; tooltip: string }>> = {
  'string[]': [
    { name: 'includes()', tooltip: "Native JS method -- true if the list/text contains the given value, e.g. @Prev.CastTypes.includes(Outro)." },
    { name: 'some()', tooltip: 'Native JS method -- true if any entry in the list matches (used with a value to compare against, e.g. via .indexOf()).' },
    { name: 'every()', tooltip: 'Native JS method -- true only if every entry in the list matches.' },
    { name: 'indexOf()', tooltip: "Native JS method -- the position of a value in the list, or -1 if it's not present." },
    { name: 'join()', tooltip: "Native JS method -- combines a list's entries into one string, e.g. for display or debugging." },
    { name: 'length', tooltip: 'Native JS property -- how many entries a list has.' }
  ],
  'string': [
    { name: 'includes()', tooltip: "Native JS method -- true if the list/text contains the given value." },
    { name: 'startsWith()', tooltip: 'Native JS method -- true if the text begins with the given value.' },
    { name: 'endsWith()', tooltip: 'Native JS method -- true if the text ends with the given value.' },
    { name: 'toLowerCase()', tooltip: 'Native JS method -- lowercases the text, useful for case-insensitive comparisons.' },
    { name: 'length', tooltip: 'Native JS property -- how many characters a piece of text has.' }
  ],
  'number': [],
  'boolean': [],
  'method': []
};
export const DSL_MATH_METHODS = ['min()', 'max()', 'floor()', 'ceil()', 'round()', 'abs()', 'pow()', 'sqrt()'];
export const DSL_MATH_METHOD_TOOLTIPS: Record<string, string> = {
  'min()': 'Math.min -- the smallest of the given numbers, e.g. Math.min(@Self.Forte1, 50).',
  'max()': 'Math.max -- the largest of the given numbers, e.g. Math.max(@Self.Energy - 20, 0).',
  'floor()': 'Math.floor -- rounds a number down to the nearest whole number.',
  'ceil()': 'Math.ceil -- rounds a number up to the nearest whole number.',
  'round()': 'Math.round -- rounds a number to the nearest whole number.',
  'abs()': 'Math.abs -- absolute value; same result as the DSL\'s own ABS(...) sugar.',
  'pow()': 'Math.pow -- raises a number to a power, e.g. Math.pow(@Self.Sequence, 2).',
  'sqrt()': 'Math.sqrt -- square root of a number.'
};

export const DSL_POINTERS: Record<string, DSLPointerDef> = {
  Self: {
    pointer: 'Self',
    targetVar: 'ctx.self',
    tooltip: 'The character that owns this mechanic node.',
    properties: [
      { propName: 'HP', type: 'number', targetKey: '.hp', tooltip: "Returns Self's current HP." },
      { propName: 'MaxHP', type: 'number', targetKey: '.maxHp', tooltip: "Returns Self's maximum HP." },
      { propName: 'Energy', type: 'number', targetKey: '.energy', tooltip: "Returns Self's current Resonance Energy." },
      { propName: 'MaxEnergy', type: 'number', targetKey: '.maxEnergy', tooltip: "Returns Self's maximum Resonance Energy." },
      { propName: 'Concerto', type: 'number', targetKey: '.concerto', tooltip: "Returns Self's current Concerto Energy." },
      { propName: 'Sequence', type: 'number', targetKey: '.sequence', tooltip: "Returns Self's Resonance Chain (sequence) level, 0-6." },
      { propName: 'PrevAction', type: 'string', fullOverride: 'ctx.self.prevAction', tooltip: 'Returns the name of the last action Self performed.' },
      { propName: 'Name', type: 'string', fullOverride: 'ctx.self.name', tooltip: "Returns Self's character name." },
      { propName: 'BuffStacks()', type: 'method', isMethod: true, argsSignature: '()', tooltip: 'Method — returns the current stack count of a buff, e.g. @Self.BuffStacks(BuffName).' },
      { propName: 'BuffMaxStacks()', type: 'method', isMethod: true, argsSignature: '()', tooltip: 'Method — returns the configured max stack count of a buff, e.g. @Self.BuffMaxStacks(BuffName).' },
      { propName: 'HasBuff()', type: 'method', isMethod: true, argsSignature: '()', tooltip: 'Method — returns true if Self currently has the given buff, e.g. @Self.HasBuff(BuffName).' },
      { propName: 'Tracker()', type: 'method', isMethod: true, argsSignature: '()', tooltip: 'Method — returns the current value of a tracker/counter, e.g. @Self.Tracker(TrackerName).' },
      { propName: 'Cooldown()', type: 'method', isMethod: true, argsSignature: '()', tooltip: 'Method — returns the remaining cooldown in seconds of a skill, e.g. @Self.Cooldown(Skill).' },
      { propName: 'Stat()', type: 'method', isMethod: true, argsSignature: '()', tooltip: 'Method — returns the current value of a sheet stat, e.g. @Self.Stat(CR Rate).' }
    ]
  },
  Enemy: {
    pointer: 'Enemy',
    targetVar: 'ctx.enemy',
    tooltip: 'The target enemy.',
    properties: [
      { propName: 'HP', type: 'number', targetKey: '.hp', tooltip: "Returns the enemy's current HP." },
      { propName: 'MaxHP', type: 'number', targetKey: '.maxHp', tooltip: "Returns the enemy's maximum HP." },
      { propName: 'HPPct', type: 'number', targetKey: '.hpPct', tooltip: "Returns the enemy's current HP as a percentage of max." },
      { propName: 'BuffStacks()', type: 'method', isMethod: true, argsSignature: '()', tooltip: 'Method — returns the current stack count of a debuff/status on the enemy.' },
      { propName: 'BuffMaxStacks()', type: 'method', isMethod: true, argsSignature: '()', tooltip: 'Method — returns the configured max stack count of a debuff/status on the enemy.' },
      { propName: 'HasBuff()', type: 'method', isMethod: true, argsSignature: '()', tooltip: 'Method — returns true if the enemy currently has the given debuff/status.' },
      { propName: 'Tune', type: 'number', targetKey: '.tune', tooltip: "Returns the enemy's current Tune (stagger) gauge value." },
      { propName: 'MaxTune', type: 'number', targetKey: '.maxTune', tooltip: "Returns the enemy's maximum Tune (stagger) gauge value." },
      // True irregularity -- compiles to the literal string "Enemy", not a ctx field.
      { propName: 'Name', type: 'string', fullOverride: '"Enemy"', tooltip: "Returns the enemy's display name." }
    ]
  },
  Move: {
    pointer: 'Move',
    targetVar: 'ctx.move',
    tooltip: 'The move currently being cast.',
    properties: [
      { propName: 'Name', type: 'string', fullOverride: 'ctx.move.name', tooltip: 'Returns the name of the move currently being cast.' },
      { propName: 'CastTypes', type: 'string[]', fullOverride: 'ctx.move.castTypes', regexPattern: 'CastTypes?', tooltip: 'Returns the list of cast-type tags for this move (e.g. Skill, Liberation).' },
      { propName: 'DmgTypes', type: 'string[]', fullOverride: 'ctx.move.dmgTypes', regexPattern: 'DmgTypes?', tooltip: 'Returns the list of damage-type tags for this move (e.g. element, cast type).' },
      { propName: 'TimeStart', type: 'number', fullOverride: 'ctx.move.timeStart', tooltip: 'Returns the time (seconds) this move started casting.' },
      { propName: 'GameTimeStart', type: 'number', fullOverride: 'ctx.move.gameTimeStart', tooltip: 'Returns the game-time (seconds) this move started casting.' },
      { propName: 'Duration', type: 'number', fullOverride: 'ctx.move.duration', tooltip: "Returns this move's total action duration, in seconds." },
      { propName: 'GameTime', type: 'number', fullOverride: 'ctx.move.gameTimePassed', tooltip: 'Returns the current simulation time, in seconds.' },
      { propName: 'FreezeTime', type: 'number', fullOverride: 'ctx.move.freezeTime', tooltip: "Returns this move's hitstop/freeze-frame duration, in seconds." },
      { propName: 'DamageStart', type: 'number', fullOverride: 'ctx.move.damageTimeframe.start', tooltip: "Returns the time offset (seconds) this move's damage window begins." },
      { propName: 'DamageEnd', type: 'number', fullOverride: 'ctx.move.damageTimeframe.end', tooltip: "Returns the time offset (seconds) this move's damage window ends." },
      { propName: 'SwapTime', type: 'number', fullOverride: 'ctx.move.swapTiming', tooltip: 'Returns the time offset (seconds) at which a swap becomes available during this move.' },
      { propName: 'BaseMult', type: 'number', fullOverride: 'ctx.move.baseMult', tooltip: "Returns this move's base damage multiplier." },
      { propName: 'HitMults', type: 'string[]', fullOverride: 'ctx.move.hitMults', tooltip: 'Returns the list of per-hit damage multipliers for this move.' },
      { propName: 'IsInHoldWindow', type: 'boolean', fullOverride: 'ctx.move.isInHoldWindow', tooltip: 'Returns true while a Hold input is being charged during this move.' }
    ]
  },
  // Prev's bare form already resolves to its identity (the acting unit) -- ctx.prev.unit, not a
  // plain container -- so every other property is its own full override rather than a suffix on
  // the bare targetVar (which would nest as ctx.prev.unit.action).
  Prev: {
    pointer: 'Prev',
    targetVar: 'ctx.prev.unit',
    tooltip: 'The character or action that was active previously.',
    properties: [
      { propName: 'Unit', type: 'string', fullOverride: 'ctx.prev.unit', regexPattern: '(Unit|name)', tooltip: 'Returns the character who performed the previous action.' },
      { propName: 'Action', type: 'string', fullOverride: 'ctx.prev.action', tooltip: 'Returns the name of the previously executed action.' },
      { propName: 'CastTypes', type: 'string[]', fullOverride: 'ctx.prev.castTypes', regexPattern: 'CastTypes?', tooltip: 'Returns the cast-type tags of the previous action.' }
    ]
  },
  // Same irregularity as Prev: bare @Next is the incoming character's name.
  Next: {
    pointer: 'Next',
    targetVar: 'ctx.next.name',
    tooltip: 'The character being swapped in next.',
    properties: [
      { propName: 'Name', type: 'string', fullOverride: 'ctx.next.name', tooltip: 'Returns the name of the character swapping in next.' },
      { propName: 'Action', type: 'string', fullOverride: 'ctx.next.action', tooltip: 'Returns the queued action the incoming character will perform.' },
      { propName: 'CastTypes', type: 'string[]', fullOverride: 'ctx.next.castTypes', regexPattern: 'CastTypes?', tooltip: "Returns the cast-type tags of the incoming character's queued action." },
      { propName: 'Priority', type: 'number', fullOverride: 'ctx.next.priority', tooltip: "Returns the priority value of the incoming character's queued action." }
    ]
  },
  Active: {
    pointer: 'Active',
    targetVar: 'ctx.active',
    tooltip: 'The character currently on-field.',
    properties: [
      { propName: 'Name', type: 'string', fullOverride: 'ctx.active.name', tooltip: 'Returns the name of the character currently on-field.' }
    ]
  },
  Default: {
    pointer: 'Default',
    targetVar: 'ctx.default',
    tooltip: 'Built-in game default values (timings, priorities), not a character.',
    properties: [
      { propName: 'SwapTime', type: 'number', targetKey: '.swapTime', tooltip: "The game's default swap-cancel timing, in seconds." },
      { propName: 'ComboWindow', type: 'number', targetKey: '.comboWindow', tooltip: "The game's default window during which a follow-up input is buffered, in seconds." },
      { propName: 'EchoSummonTime', type: 'number', targetKey: '.echoSummonTime', tooltip: "The game's default cast time before an Echo skill's effect triggers, in seconds." },
      { propName: 'PermanentDuration', type: 'number', targetKey: '.permanentDuration', tooltip: "A very large duration constant used for effects that shouldn't expire." },
      { propName: 'BasicPriority', type: 'number', targetKey: '.basicPriority', tooltip: 'Default action-priority value for Basic Attacks.' },
      { propName: 'HeavyPriority', type: 'number', targetKey: '.heavyPriority', tooltip: 'Default action-priority value for Heavy Attacks.' },
      { propName: 'SkillPriority', type: 'number', targetKey: '.skillPriority', tooltip: 'Default action-priority value for Resonance Skills.' },
      { propName: 'EchoPriority', type: 'number', targetKey: '.echoPriority', tooltip: 'Default action-priority value for Echo skills.' },
      { propName: 'DodgePriority', type: 'number', targetKey: '.dodgePriority', tooltip: 'Default action-priority value for Dodges.' },
      { propName: 'JumpPriority', type: 'number', targetKey: '.jumpPriority', tooltip: 'Default action-priority value for Jumps.' },
      { propName: 'LibPriority', type: 'number', targetKey: '.libPriority', tooltip: 'Default action-priority value for Resonance Liberations.' },
      { propName: 'IntroPriority', type: 'number', targetKey: '.introPriority', tooltip: 'Default action-priority value for Intro Skills.' },
      { propName: 'OutroPriority', type: 'number', targetKey: '.outroPriority', tooltip: 'Default action-priority value for Outro Skills.' }
    ]
  },
  // Bare-only pointers: no dot-properties are offered for these today.
  Team: { pointer: 'Team', targetVar: 'ctx.team', tooltip: 'All characters currently in the team roster.', properties: [] },
  TeamOthers: { pointer: 'TeamOthers', targetVar: 'ctx.teamOthers', tooltip: 'All team members except Self.', properties: [] },
  Equipper: { pointer: 'Equipper', targetVar: 'equipper', tooltip: 'The character this weapon or echo is equipped on.', properties: [] },
  // Call-only: @System(Name) resolves via the generic @Namespace(...) string-literal rule in
  // DSLParser, not a pointerMap entry -- no targetVar.
  System: { pointer: 'System', usesCallSyntax: true, tooltip: 'Global effects not tied to a specific character.', properties: [] }
};

// Legacy parser-only translation entries with no corresponding visible autocomplete property:
// the digit-capturing Forte/MaxForte scalars (Self.Forte{N}/MaxForte{N} are synthesized
// dynamically in the autocomplete resolver from baseStats.forteCount, never listed statically
// here, but the parser needs one regex covering any N).
export const DSL_PARSER_SCALAR_EXTRAS: Record<string, string> = {
  '\\.MaxForte([0-9]+)': '.maxForte$1',
  '\\.Forte([0-9]+)': '.forte$1'
};
