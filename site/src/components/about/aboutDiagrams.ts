// Mermaid sources for the About page, one per diagram; node classes are the NODE_KINDS ids.
export const DIAGRAMS = {
  layers: `
    graph TD
    Entry["<b>Entry + shell</b><br/>main.tsx; App.tsx: boot gate, view switch, freshness triggers<br/>useHashRoute, config/nav.ts, Header, LandingPage"]:::ui
    Pages["<b>src/components</b> (pages)<br/>Calculator: roster/ rotation/ results/ timeline/ · Builder: builder/<br/>Rankings: rankings/ · Guide: guide/ · About: about/ · shared: common/"]:::ui
    Hooks["<b>src/hooks</b><br/>useHashRoute, useUiScale, useImageStatus,<br/>popup + accordion helpers"]:::ui
    Stores["<b>src/store</b> (Zustand + persist)<br/>useRosterStore, useRotationStore, useBuilderStore,<br/>useRotationHistoryStore, useComparisonStore,<br/>useRankingsStore, useGuideSelectionStore"]:::store
    Sys["<b>src/systems</b><br/>HistoryManager:<br/>commands, undo / redo"]:::logic
    Work["<b>src/workers</b><br/>calcWorkerClient: main lane + pool<br/>calc.worker, runFullCalculation"]:::worker
    Logic["<b>src/logic</b> (pure)<br/>TimelineEngine, EventManager, ContextManager,<br/>CombatCalculator + combat/, ResultsCalculator,<br/>RepeatBlocks, MechanicOwners, dsl/"]:::logic
    Util["<b>src/utils, data, types, config</b><br/>DataLoader, dataFreshness, dataSource, idbStore,<br/>db.ts tables, gameVocab, small helpers"]:::data
    Ext[("data repo (GitHub raw), /wip-data (dev),<br/>localStorage, IndexedDB")]:::data
    Entry --> Pages
    Pages --> Hooks
    Pages --> Stores
    Stores --> Sys
    Stores --> Work
    Work --> Logic
    Pages -.->|"dropdowns, previews"| Logic
    Logic --> Util
    Stores --> Util
    Util --> Ext
    Stores -.->|"persist"| Ext
  `,
  bootStartup: `
    graph LR
    subgraph Hydrate["1 · module load: stores rehydrate"]
      direction TB
      H1["useRosterStore: once DataLoader.ready,<br/>loadMechanic every team entity,<br/>applyBuilderOverridesForTeam"]:::store
      H2["useRotationStore: rows get ids;<br/>reviveCommand rebuilds undo / redo<br/>(no recalculate yet)"]:::store
      H3["Builder edit log, History, pin,<br/>Rankings UI, guide selection:<br/>restored as saved"]:::store
      H1 ~~~ H2 ~~~ H3
    end
    subgraph Main["2 · main.tsx"]
      direction TB
      M1["createRoot().render<br/>App in StrictMode"]:::ui --> M2{"production<br/>build?"}
      M2 -- yes --> M3["register /sw.js<br/>on window load"]:::data
      M2 -- "no (dev)" --> M4["installWipImageFallback:<br/>a failed /wip-data image<br/>retries the data repo"]:::data
    end
    subgraph Mount["3 · App mount"]
      direction TB
      A1["DataLoader.initDatabases<br/>refreshManifest(force); loadMergedDB: characters,<br/>weapons, builds, echoes; weaponsByType;<br/>set → echo mapping; System mechanics; ready"]:::data
      A1 --> A2["refreshActiveBuilderItem(force):<br/>checkBuilderItemFreshness + setActiveChar"]:::store
      A2 --> A3["isLoaded → Header + view +<br/>FreshnessConflictDialog<br/>(until then: Loading databases...)"]:::ui
      A3 --> A4["tab refocus: freshness check for the view;<br/>Builder view: 3 s poll too"]:::ui
    end
    Hydrate --> Main --> Mount
  `,
  bootRouting: `
    graph LR
    N["nav click:<br/>navigate(view)"]:::ui --> NT{"target"}
    NT -->|"current hash"| NS["setRoute(parseHash())"]:::ui
    NT -->|"landing"| NL["pushState to a clean<br/>URL, setRoute"]:::ui
    NT -->|"calculator"| NC["#/calculator/step-N<br/>N = remembered step"]:::ui
    NT -->|"guide"| NG["#/guide/Name<br/>Name = remembered"]:::ui
    NT -->|"builder, rankings,<br/>about"| NO["#/view"]:::ui
    NC --> EV
    NG --> EV
    NO --> EV
    EV["hashchange /<br/>popstate"]:::ui --> P{"parseHash:<br/>first segment"}
    P -->|"calculator"| PC["step from the hash, else the<br/>remembered one; saved to<br/>wuwa_calc_last_step"]:::data
    P -->|"guide"| PG["character from the hash, saved to<br/>wuwa_calc_last_guide_character<br/>(a bare #/guide clears it)"]:::data
    P -->|"builder, rankings,<br/>about"| PO["that view"]
    P -->|"empty or<br/>unknown"| PL["landing"]
    PC --> V
    PG --> V
    PO --> V
    PL --> V
    V["App renders the view<br/>calculator: ResultsPanel + TeamBuilder + RotationBuilder<br/>builder: MechanicsBuilder · rankings: RotationRankingsPage<br/>guide: CharacterGuidePage · about: AboutPage<br/>landing: LandingPage, a card per NAV_ITEM"]:::ui
  `,
  teamEdits: `
    graph LR
    I1["Character picker"]:::ui --> A1["setSlotField(character):<br/>weapon + mode cleared,<br/>loadMechanic, publishTeam"]:::store
    A1 --> A2
    I2["Load Recommended Build"]:::ui --> A2["applyRecommendedBuild: db_builds' first<br/>role: weapon, sets, main echo (each<br/>loadMechanic); recommendedEchoes"]:::store
    I3["weapon, rank, sequence,<br/>mode, layout, sets, main echo"]:::ui --> A3{"setSlotField<br/>(field)"}
    A3 -->|"layout"| A4["main stats remapped to<br/>what each cost allows"]:::store
    A3 -->|"weapon, main echo"| A5["loadMechanic"]:::data
    A3 -->|"a set"| A6["loadMechanic(sets); the main echo<br/>dropped if the main set is 1pc<br/>or it's no longer allowed"]:::data
    A3 -->|"number, mode"| A7["value set"]:::store
    A2 --> C
    A4 --> C
    A5 --> C
    A6 --> C
    A7 --> C
    I4["Remove from Roster"]:::ui --> A8["clearSlot: createEmptySlot"]:::store --> C
    C["calculateEchoStatsForSlot, then commitTeam:<br/>publishTeam (applyBuilderOverridesForTeam,<br/>set team)"]:::store --> R
    I5["EchoCard substat"]:::ui --> A9["setSubstat: echo stats<br/>recounted, team set"]:::store --> R
    I6["enemy level, RES, HP"]:::ui --> A10["setEnemyField"]:::store --> R
    I7["Import Team: a team file,<br/>or a rotation file's team"]:::ui --> A11["importTeam: slots merged, loadTeamMechanics,<br/>echo stats, publishTeam; recalculate awaited"]:::store --> R
    R["useRotationStore<br/>.recalculate"]:::store
  `,
  teamDisplay: `
    graph LR
    subgraph Pick["pickers (CharacterSlot)"]
      direction TB
      P1["selectableOptions: everything listed; disabled<br/>(Not yet implemented) unless the manifest has<br/>its mechanics file or the Builder edited it"]:::ui
      P1 --> P2["weapons of the character's type;<br/>main echoes: allowedMainEchoes<br/>(main set's, + a 3pc set's sub set's)"]:::ui
      P2 --> P3{"main set"}
      P3 -->|"3pc"| P4["+ Sub Set"]:::ui
      P3 -->|"1pc"| P5["+ Extra Set A / B;<br/>no main echo"]:::ui
      P3 -->|"other"| P6["+ Main Echo"]:::ui
    end
    subgraph Idle["IdleStats: getIdleStats(slot)"]
      direction TB
      S1["ALWAYS buffs: the slot's own kit (@Self,<br/>@Equipper), teammates' (@Team,<br/>@TeamOthers), and System"]:::store
      S1 --> S2["CombatCalculator.calculateFinalStats:<br/>character + weapon base, echo stats,<br/>weapon substat, talents, the buffs"]:::logic
      S2 --> S3["a card per unit: HP, ATK, DEF, ER,<br/>crit, DMG bonuses; enemy card"]:::ui
    end
    subgraph Head["collapsed header"]
      direction TB
      T1["TeamPreview: character + S,<br/>weapon + R per slot"]:::ui
    end
    Pick ~~~ Idle ~~~ Head
  `,
  rotationActions: `
    graph LR
    subgraph Cands["candidates"]
      direction TB
      C1["the row unit's owners: getMechanicOwners,<br/>character › echo › weapon › set › System"]:::logic
      C1 --> C2["getCastableMechanics:<br/>every non-passive node"]:::logic
    end
    subgraph Valid["checkValid, per move"]
      direction TB
      V0["1 modeScope fits the slot's mode<br/>2 trigger rule passes: DSLParser.compile,<br/>evaluated on buildContext(the row's pre-cast state)<br/>3 hold pairing: a Release only while this unit<br/>holds its input, a Press only when it doesn't"]:::logic
      V0 --> V1{"all pass?"}
      V1 -- yes --> V2["valid"]
      V1 -- no --> VX["dropped, unless it's the<br/>row's current action"]:::alert
    end
    subgraph Opts["options"]
      direction TB
      O1["one per input + inputType + stanceReq:<br/>highest-priority valid move wins<br/>(the current action stays listed)"]:::logic
      O1 --> O2["groups: category + skill group name,<br/>Echo Skill, weapon / set name, System"]:::logic
      O2 --> O3["sorted by priority; groups in<br/>BUILDER_CATEGORIES order"]:::logic
    end
    subgraph Ctl["the row's other controls"]
      direction TB
      R1["Unit: loadMechanic character + main echo,<br/>applyBuilderOverridesFor, setRowUnit"]:::store
      R2["Timing: row.availableTimings<br/>(from the engine)"]:::ui
      R3["Offset: offset + manualOffset,<br/>committed on blur / Enter"]:::store
      R4["Time, Offset, DMG, gauge cells:<br/>SubPanel by PANEL_CONFIG"]:::ui
      R1 ~~~ R2 ~~~ R3 ~~~ R4
    end
    Cands --> Valid --> Opts
    Opts ~~~ Ctl
  `,
  rotationEdits: `
    graph LR
    subgraph In["edits come from"]
      direction TB
      I1["RotationRow: unit,<br/>action, timing, offset"]:::ui
      I2["RotationToolbar: Copy, Paste, Delete,<br/>Mark Repeat, Insert Above / Below,<br/>Undo, Redo, Full Energy / Concerto"]:::ui
      I3["keys: Delete, Ctrl+C / V, Ctrl+Z / Y,<br/>Ctrl+Shift+Z, Ctrl+Up / Down;<br/>drag rows, shift-click to select a range"]:::ui
      I1 ~~~ I2 ~~~ I3
    end
    subgraph Act["useRotationStore → commands"]
      direction TB
      A1["setRowUnit: EditFields (unit, action cleared)<br/>+ AddRow when it was the blank last row"]:::store
      A2["updateRowField(action): EditValue; if the next<br/>row is blank and this isn't an Outro, the unit<br/>carries down (+ AddRow)"]:::store
      A3["deleteRows: EditFields moving a deleted<br/>repeat marker onto the surviving rows,<br/>then DeleteRows"]:::store
      A4["pasteRows: EditValue over selected rows,<br/>AddRow the extra, DeleteRows the leftover;<br/>fresh repeat group ids"]:::store
      A5["moveRows: MoveRows · insert: AddRow"]:::store
      A6["Full Energy / Concerto: set + recalculate<br/>(not undoable)"]:::store
      A1 ~~~ A2 ~~~ A3 ~~~ A4 ~~~ A5 ~~~ A6
    end
    subgraph Hist["HistoryManager"]
      direction TB
      H1["execute: one command, or a<br/>CompositeCommand (one undo step)"]:::logic
      H1 --> H2["undo stack (max 50), redo cleared;<br/>undo / redo move commands between them"]:::logic
      H2 --> H3["canUndo / canRedo + serialized stacks<br/>→ wuwa_calc_rotation_cache"]:::data
      H3 --> H4["onComplete: triggerRecalc<br/>(one microtask per burst of edits)"]:::store
    end
    In --> Act --> Hist
  `,
  rotationMarkers: `
    graph LR
    subgraph Loop["loop markers"]
      direction TB
      L1["drag Loop Start / Loop End,<br/>or a marker's reset button"]:::ui --> L2{"row has a unit, and not<br/>inside a repeat block?<br/>(start may sit on a block's first row)"}
      L2 -- yes --> L3["SetLoopStart / SetLoopEnd:<br/>moves the one flag"]:::store
      L2 -- no --> L4["ignored"]:::alert
    end
    subgraph Rep["repeat blocks"]
      direction TB
      R1["Mark Repeat on a selection,<br/>or drag a block's marker"]:::ui --> R2{"both ends have units,<br/>start ≤ end, and the block doesn't<br/>straddle the loop start / end?"}
      R2 -- yes --> R3["SetRepeatBlockStart + End:<br/>new groupId, repeatCount 2"]:::store
      R2 -- no --> R4["ignored"]:::alert
      R3 --> R5["setRepeatCount (≥ 1),<br/>setRepeatFinalTiming"]:::store
    end
    subgraph Ending["Ending Rotation"]
      direction TB
      E1["toolbar checkbox"]:::ui --> E2{"turned"}
      E2 -->|"on"| E3{"already tagged,<br/>or no rows yet?"}
      E3 -- yes --> E4["flag only"]:::store
      E3 -- no --> E5["one step: SetLoopEnd on the last row<br/>+ AddRow a copy of the loop<br/>(fresh repeat ids)"]:::store
      E2 -->|"off"| E6["resetLoopEnd: rows after the loop end<br/>deleted, marker cleared, flags off"]:::store
      E7["starts earlier (marker checkbox):<br/>flag + recalculate"]:::ui
    end
    Loop ~~~ Rep ~~~ Ending
  `,
  recalcRoundTrip: `
    graph LR
    subgraph Send["runWorkerCalc: send"]
      direction TB
      K1["recalculate(markStale, includeDamage): edits,<br/>roster changes, imports; RotationBuilder mount<br/>once (false, true) · calculateDamage: Calculate,<br/>sends the loop start as an expanded-row index"]:::store
      K1 --> S1["snapshot team, enemy, rows, Full Energy /<br/>Concerto, Ending Rotation flags"]:::store
      S1 --> S2["checkTeamFreshness → staleRefs"]:::data
      S2 --> S3["expandRepeatBlocks: each block cloned<br/>repeatCount times (the last rep's end row<br/>uses repeatFinalTiming) + collapseMap"]:::logic
      S3 --> S4["postToWorker: + buildBuilderPayload (the<br/>team's Builder edits); a sequence id;<br/>main lane, one request at a time"]:::worker
    end
    subgraph Recv["runWorkerCalc: reply"]
      direction TB
      Q1{"reply"}
      Q1 -->|"error"| Q2["logged;<br/>isCalculating off"]:::alert
      Q1 -->|"a newer request of<br/>this type was sent since"| Q3["dropped"]:::alert
      Q1 -->|"latest"| Q4["collapseRepeatResults: a row per authored<br/>row (first rep's start, last rep's state;<br/>damage + deltas summed)"]:::logic
      Q4 --> W1{"type"}
      W1 -->|"recalculate"| W2["rows (earlier damage kept<br/>by row id), loop start + issues;<br/>isStale if markStale"]:::store
      W1 -->|"calculateDamage"| W3["rows + results, isStale off,<br/>builderOverridesSnapshot,<br/>History addEntry"]:::store
    end
    Send -->|"calc.worker<br/>(next diagram)"| Recv
  `,
  recalcWorker: `
    graph LR
    subgraph Prep["every request"]
      direction TB
      P1["getReady: this worker's own<br/>DataLoader.initDatabases (once)"]:::worker
      P1 --> P2{"calculateDamage, and the<br/>team has Builder edits?"}
      P2 -- yes --> P3["initDatabases again +<br/>clearMechanicCache every team<br/>entity (pristine re-fetch)"]:::worker
      P2 -- no --> P4
      P3 --> P4["clearMechanicCache each staleRef"]:::worker
      P4 --> P5["loadTeamMechanics (+ System),<br/>applyBuilderOverridesToDataLoader"]:::worker
    end
    subgraph Run["run"]
      direction TB
      T{"type"}
      T -->|"recalculate"| R1["recalculateState;<br/>includeDamage: +<br/>populateDamageInstances"]:::logic
      R1 --> R2["findLoopStart<br/>(collapseMap),<br/>analyzeLoop"]:::logic
      R2 --> R3["Ending Rotation on:<br/>previewEndingRotationTiming"]:::logic
      T -->|"calculateDamage"| D1["recalculateState; unless<br/>summaryOnly: +<br/>populateDamageInstances"]:::logic
      D1 --> D2["loop start: the one sent,<br/>else findLoopStart"]:::logic
      D2 --> D3["Ending Rotation on:<br/>the preview, its run<br/>kept for reuse"]:::logic
      D3 --> D4{"summaryOnly?"}
      D4 -- yes --> D5["buildRotationSummary"]:::logic
      D4 -- no --> D6["buildRotationResults"]:::logic
    end
    subgraph Reply["reply"]
      direction TB
      Y1["stripFunctions (compiled rules<br/>can't be cloned); postMessage ok"]:::worker
      Y2["anything throws:<br/>postMessage error"]:::alert
      Y1 ~~~ Y2
    end
    Prep --> Run --> Reply
  `,
  recalcLanes: `
    graph LR
    subgraph Callers["one-shot callers"]
      direction TB
      C1["runFullCalculation: pins,<br/>the Guide's selected config"]:::worker
      C2["useRotationTimelineData:<br/>Rankings timeline (recalculate)"]:::worker
      C3["runSummaryCalculation: Guide<br/>comparisons, Export Rotation"]:::worker
      C1 ~~~ C2 ~~~ C3
    end
    subgraph Build["buildCalcRequest"]
      direction TB
      B1["checkTeamFreshness → staleRefs"]:::data
      B1 --> B2["expandRepeatBlocks (no loop start:<br/>the worker finds it)"]:::logic
    end
    subgraph Lanes["calcWorkerClient"]
      direction TB
      L1["postToWorker → main lane, shared with<br/>the Calculator: one at a time, queued;<br/>worker created on first use"]:::worker
      L2["postToWorkerPool → pool lanes: a new lane<br/>while all are busy, up to min(4, cores − 1);<br/>the least busy takes it"]:::worker
      L2 --> L3{"still wanted when<br/>its turn comes?"}
      L3 -- no --> L4["CancelledError"]:::alert
      L3 -- yes --> L5["runs (summaryOnly)"]:::worker
      L1 ~~~ L2
    end
    Callers --> Build --> Lanes
  `,
  enginePass: `
    graph LR
    subgraph Setup["setup"]
      direction TB
      S1["recalculateState(rows, team, options, enemy)<br/>full: the table · silent: re-runs ·<br/>lean: loop check (no snapshots, no hit log)"]:::logic
      S1 --> S2["clocks, hit queue and caches reset;<br/>calculateEchoStatsForSlot per slot"]:::logic
      S2 --> S3["_setupEventBoard: EventManager.reset,<br/>every owner's listeners registered"]:::logic
      S3 --> S4["@Prev / @Next rows linked,<br/>each unit's next action noted"]:::logic
    end
    subgraph Before["each row: before the move"]
      direction TB
      W0{"row has<br/>a unit?"}
      W0 -- no --> W1["inherits only"]:::logic
      W0 -- yes --> W2["_getModifiedMoveData<br/>(cached per action)"]:::logic
      W2 --> W3["_applyInheritance: pools, trackers,<br/>cooldowns, buffs (removeOnSwap dropped<br/>on a swap), @Next buffs, stance"]:::logic
      W3 --> W4["first row: Full Energy / Concerto,<br/>_primeCombatStart (OnStart + ALWAYS)"]:::logic
      W4 --> W5["waits, then _resolveTimings<br/>(next diagrams)"]:::logic
    end
    subgraph Move["each row: the move"]
      direction TB
      M1{"Simultaneous?"}
      M1 -- yes --> M2["at the previous row's<br/>start + offset; clock stays"]:::logic
      M1 -- no --> M3["after the waits;<br/>clock advances"]:::logic
      M2 --> M4
      M3 --> M4["offsetReasons; hold cursor<br/>tracking; dropdown snapshot"]:::logic
      M4 --> M5["_runValidation"]:::alert
      M5 --> M6["_evaluateMechanics: cast,<br/>time passes, hits land"]:::logic
      M6 --> M7["_resolveComboWindows<br/>(@Self.PrevAction), _resolvePriority"]:::logic
    end
    subgraph After["after the last row"]
      direction TB
      F1["trailing blank row inherits<br/>the final state"]:::logic
      F1 --> F2["flush: _decayState until the<br/>queue is empty (late hits, procs)"]:::logic
      F2 --> F3["rows: times, pools, buffs, trackers,<br/>_pendingHits, errors, warnings,<br/>availableTimings"]:::logic
    end
    Setup --> Before --> Move --> After
  `,
  engineWaits: `
    graph LR
    subgraph CdBusy["cooldown + busy"]
      direction TB
      A1{"unit differs from<br/>the previous row?"}
      A1 -- yes --> A2["global swap cooldown starts"]:::logic
      A1 -- no --> A3
      A2 --> A3["cooldown wait: cooldownRemaining<br/>(charges: only once every one is out)"]:::logic
      A3 --> A4["busy wait: the unit's last animation<br/>(unitBusyUntil); none for an Outro"]:::logic
      A4 --> A5["wait = the larger; _applyDecay:<br/>time runs, hits land"]:::logic
    end
    subgraph Res["resources"]
      direction TB
      B1{"_computeResourceWait: short on<br/>Concerto, Forte or Tune?<br/>(Energy stays a warning)"}
      B1 -- yes --> B2["advance hit by hit to queued hits<br/>that grant it, until enough or none<br/>left; added to the wait"]:::logic
      B1 -- no --> B3["no wait"]
      B2 --> B4["backfillPools: the previous row shows<br/>pools as they were right before this"]:::logic
      B3 --> B4
    end
    subgraph Hold["hold release"]
      direction TB
      C1{"a Release with holdConfig,<br/>while this unit holds?"}
      C1 -- no --> C0["no hold wait"]
      C1 -- yes --> C2["look ahead (up to holdLookaheadMax)<br/>for the cursor to be done: clamp: full or<br/>empty; else inside the window"]:::logic
      C2 --> C3{"row timing"}
      C3 -->|"Manual"| C4["wait manualOffset,<br/>at most the auto wait"]:::logic
      C3 -->|"other, done found"| C5["wait until done<br/>(Forte Full / Window Wait)"]:::logic
      C3 -->|"other, never done"| C6["_holdUnreachable<br/>→ error"]:::alert
    end
    CdBusy --> Res --> Hold
  `,
  engineTimings: `
    graph LR
    subgraph Base["inputs (DSL math resolved)"]
      direction TB
      T1["actionDuration, freezeTime, swapTiming,<br/>damageTimeframe, hit count"]:::logic
      T1 --> T2{"each cancelTiming:<br/>has a trigger rule?"}
      T2 -- yes --> T3["valid if it passes"]:::logic
      T2 -- no --> T4["valid if the next move outranks<br/>this one on another input"]:::logic
      T3 --> T5
      T4 --> T5["availableTimings: Auto, Full; Swap (swapTiming);<br/>Cap Energy / Concerto (a hit would fill it);<br/>Cancel N; Simultaneous (Hold or Echo);<br/>Manual (Release with holdConfig)"]:::ui
    end
    subgraph Pick["row.timing"]
      direction TB
      P0{"timing"}
      P0 -->|"Auto"| PA{"next row"}
      PA -->|"Outro, and a hit<br/>fills Concerto"| PA1["end at that hit"]:::logic
      PA -->|"Outro or another unit,<br/>and swapTiming"| PA2["as Swap"]:::logic
      PA -->|"otherwise"| PA3["quickest cancel with every<br/>hit, else full duration"]:::logic
      P0 -->|"Full"| PF["full duration"]:::logic
      P0 -->|"Swap"| PS["max(swapTiming, swapTime);<br/>unit stays busy to its cancel"]:::logic
      P0 -->|"Cap_*_N /<br/>Cancel_N"| PN["end at hit N /<br/>that cancel"]:::logic
    end
    subgraph Fin["result"]
      direction TB
      F1{"swapping out before the<br/>global swap cooldown ends?"}
      F1 -- yes --> F2["extended by the difference"]:::logic
      F1 -- no --> F3
      F2 --> F3["duration, animationCommitment,<br/>gameTimePassed = duration − freeze,<br/>allowedHits"]:::logic
      F3 --> F4["stance: stanceReq, then any<br/>stanceChanges before the end"]:::logic
    end
    Base --> Pick --> Fin
  `,
  engineValidation: `
    graph LR
    C1["Energy below the move's cost<br/>(message says the ER% that would fix it)"]:::logic --> W
    C2["cooldown wait over 3 frames"]:::logic --> W
    C3["trigger rule fails, and nothing<br/>above already explains why"]:::logic --> W
    C4["stanceReq ≠ the stance it started in"]:::logic --> W
    C5["Concerto, Forte or Tune below the cost"]:::logic --> E
    C6["hold never reaches its target"]:::logic --> E
    C7["after an Outro: same unit,<br/>or the move isn't an Intro"]:::logic --> E
    C8["an Intro not right after an Outro"]:::logic --> E
    C9["after a Swap timing: same unit,<br/>and not an Outro"]:::logic --> E
    C10["swap-in outside the unit's combo window,<br/>its isSwapInDefault moves are valid,<br/>and this isn't one of them"]:::logic --> E
    W["warning:<br/>row.warningMsgs"]:::alert
    E["error:<br/>row.errorMsgs"]:::alert
    W --> U
    E --> U["shown on the row;<br/>analyzeLoop re-reads the<br/>second rep's messages"]:::ui
  `,
  engineMove: `
    graph LR
    subgraph Cast["cast (_evaluateMechanics)"]
      direction TB
      M1["freezeTime: other units' queued<br/>hits pushed later by it"]:::logic
      M1 --> M3["_startCooldown: a timer or a charge;<br/>the shareCooldownWith partner too"]:::logic
      M3 --> M4["_applyCastResources: Energy gains to every<br/>unit (× its ER, logged); rest to the caster"]:::logic
      M4 --> M5["_gatherInstantEffects: the move's effects<br/>+ OnCast (+ OnSwapOut / In, OnUnitChange)"]:::logic
      M5 --> M6["_scheduleHits: hitMults spread over the<br/>damageTimeframe (DSL snapshot)"]:::logic
      M6 --> M7["_executeEffectsStream: procs queued,<br/>other effects → _processEffect"]:::logic
    end
    subgraph Hits["time passes (_decayState)"]
      direction TB
      D1["over the row's duration<br/>(a Simultaneous row: none)"]:::logic
      D1 --> D2["_processQueuedHits:<br/>each hit now due"]:::logic
      D2 --> D3{"within<br/>allowedHits?"}
      D3 -- no --> D4["skipped<br/>(cut short)"]:::alert
      D3 -- yes --> D5["hitResources (Energy to the<br/>team, rest to the caster); OnHit"]:::logic
      D5 --> D6["_pendingHits: hit config + state<br/>snapshot, priced later"]:::logic
      D6 --> D7["AfterHit(n)"]:::logic
    end
    subgraph Decay["between hits (_processGameTimeDecay)"]
      direction TB
      G1["buffs tick (time_scale applies;<br/>paused ones don't)"]:::logic
      G1 --> G2{"a buff<br/>runs out?"}
      G2 -- yes --> G3["OnBuffExpire; drop_one / drop_half<br/>refresh, else every stack gone"]:::logic
      G2 -- no --> G4
      G3 --> G4["cooldowns, charges and<br/>time scales run down"]:::logic
      G4 --> G5["OnTick"]:::logic
    end
    Cast --> Hits --> Decay
  `,
  engineLoop: `
    graph LR
    subgraph Find["findLoopStart"]
      direction TB
      L1{"a row has the<br/>Loop Start marker?"}
      L1 -- yes --> L2["that row"]:::logic
      L1 -- no --> L3{"main DPS (slot 1) has an Outro?<br/>(the first not in an earlier repeat copy)"}
      L3 -- yes --> L4["the row after it<br/>(row 0 if that's blank)"]:::logic
      L3 -- no --> L5["row 0"]:::logic
    end
    subgraph Check["analyzeLoop"]
      direction TB
      A1["opener | loop template<br/>(stops at the Loop End marker)"]:::logic
      A1 --> A2{"loop has<br/>duration?"}
      A2 -- no --> A3["error: Loop has<br/>no duration"]:::alert
      A2 -- yes --> A4["recalculateState(opener + loop + loop),<br/>lean mode"]:::logic
      A4 --> A5["second rep only: errors, and Combo<br/>requirement → errors; resource shortfall<br/>and cooldown waits → warnings"]:::logic
    end
    subgraph Show["shown"]
      direction TB
      S1["loop start mapped back through<br/>collapseMap; loop issue strips"]:::ui
    end
    Find --> Check --> Show
  `,
  eventsEmit: `
    graph LR
    subgraph Reg["register (every run)"]
      direction TB
      R1["getMechanicOwners(team), per slot: sets<br/>(N-pc nodes need N pieces), main echo,<br/>weapon (rank-scaled), character; System"]:::logic
      R1 --> R2{"listens? passive nodes,<br/>+ a character's Outro"}
      R2 -- yes --> R3["registerMechanic: effectiveTriggerRule<br/>(no rule on a passive = ALWAYS),<br/>DSLParser.compile; a listener per trigger"]:::logic
    end
    subgraph Emit["EventManager.emit(event, tags)"]
      direction TB
      E1["the event's listeners + ALWAYS ones<br/>(not for OnStart / ALWAYS), by priority"]:::logic
      E1 --> E2{"[self] and [tags]<br/>match the move?"}
      E2 -- no --> E3["skipped"]
      E2 -- yes --> E4["ContextManager.buildContext<br/>for the equipper (cached per unit)"]:::logic
      E4 --> E5{"event"}
      E5 -->|"OnTick(interval, max)"| E6["scaled game time adds up;<br/>once per interval passed"]:::logic
      E5 -->|"AfterHit(n)"| E7["only after hit n<br/>(all: the last)"]:::logic
      E5 -->|"others"| E8["off cooldown and<br/>the rule passes?"]:::logic
    end
    subgraph Out["effects returned"]
      direction TB
      O1["passes: hitMults → procced_mechanic (MATH<br/>mults resolved); effects with @Equipper<br/>+ provider filled in; its cooldown"]:::logic
      O2["an ALWAYS listener on another<br/>event: buff effects only"]:::logic
      O3["an ALWAYS listener that fails: its<br/>buffs removed (buffAction remove ALL)"]:::alert
      O1 ~~~ O2 ~~~ O3
    end
    Reg --> Emit --> Out
  `,
  eventsEffects: `
    graph LR
    subgraph Pre["_processEffect"]
      direction TB
      P1["DSL values resolved (value, duration,<br/>maxStacks); source + provider set"]:::logic
      P1 --> P2{"target @Next?"}
      P2 -- yes --> P3["pendingNextBuffs: applied to the<br/>next row's unit on inheritance"]:::logic
      P2 -- no --> P4["_resolveTargets: @Self, @Team,<br/>@TeamOthers, @Enemy, @Active, a name"]:::logic
    end
    subgraph Types["by type"]
      direction TB
      T1["buff → _updateActiveBuffs: filled from its named<br/>template; rank value; stacks up to maxStacks<br/>(separate: a timer each) → OnBuffAdd"]:::logic
      T2["buffAction: pause, resume, extend; remove /<br/>consume stacks → OnBuffRemove / Consume"]:::logic
      T3["tracker → _handleTracker: add, remove, consume, set,<br/>copy, detonate, delete (max cap) → OnTrackerAdd /<br/>Remove / Consume / Detonate / Changed"]:::logic
      T4["resource: tune → enemy Tune; Energy gains<br/>× ER (logged); others capped per unit"]:::logic
      T5["cooldown: sets a timer ·<br/>time_scale: speeds or slows timers"]:::logic
      T1 ~~~ T2 ~~~ T3 ~~~ T4 ~~~ T5
    end
    Pre --> Types
  `,
  damage: `
    graph LR
    subgraph In["input"]
      direction TB
      I1["priceHits: each row's _pendingHits in order,<br/>against the enemy's running HP"]:::logic
      I1 --> I2["calculateDamageInstance(config, context)<br/>hitMult: 150% scales a stat,<br/>a plain number is flat"]:::logic
    end
    subgraph Kind["formula"]
      direction TB
      K1{"castTypes or title<br/>mention Tune?"}
      K1 -- yes --> KT["Tune"]
      K1 -- no --> K2{"dmgTypes is just one<br/>negative status?"}
      K2 -- yes --> KN["NegativeStatus"]
      K2 -- no --> KS["Standard"]
    end
    subgraph Std["Standard"]
      direction TB
      S1["calculateFinalStats (unbuffed sheet)"]:::logic
      S1 --> S2["aggregateBuffTotals: live stat buffs on this unit,<br/>the team or the active unit; applyTo tags, else<br/>scope from the stat name; a bucket each"]:::logic
      S2 --> S3["scalar ATK / HP / DEF / None × mult;<br/>crit expectation; DMG bonus from<br/>dmgTypes + buffs"]:::logic
      S3 --> S4["calcStandardDmg × calcResistance ×<br/>calcDefense (+ non-crit, crit)"]:::logic
    end
    subgraph Other["Tune, NegativeStatus"]
      direction TB
      T1["Tune: no scalar stat; calcTuneDmg<br/>(TUNE_BASE_DMG, Boost, Taken, Multi)"]:::logic
      N1["NegativeStatus: only @Enemy debuffs or buffs<br/>naming the status; base from the enemy's<br/>stacks → calcNegativeStatusDmg"]:::logic
      T1 ~~~ N1
    end
    subgraph Result["result"]
      direction TB
      O1["formatDamageBreakdown:<br/>display mult + calculation"]:::logic
      O1 --> O2["enemyHp reduced; DamageInstanceResult:<br/>total, nonCrit, crit, formulaUsed, data"]:::logic
    end
    In --> Kind
    Kind -->|"Standard"| Std --> Result
    Kind -->|"Tune, NegativeStatus"| Other --> Result
  `,
  resultsCalculate: `
    graph LR
    subgraph Ext["buildExtendedTimeline"]
      direction TB
      X1["splitLoopSegments: opener | loop template |<br/>ending rows (Ending Rotation, after Loop End)"]:::logic
      X1 --> X2{"loop"}
      X2 -->|"none"| X3["runs the opener alone"]:::logic
      X2 -->|"no duration"| X4["runs everything once"]:::logic
      X2 -->|"ok"| X5["reps: with Ending Rotation, whole loops that fit<br/>in 120 s (−1 if it starts earlier); else enough to<br/>pass 120 s; at least 3"]:::logic
      X5 --> X6["the Ending Rotation preview's run if the same<br/>length, else recalculateState(silent);<br/>each rep's real end read off it"]:::logic
    end
    subgraph Hits["buildHitList"]
      direction TB
      H1["priceHits: every _pendingHit through<br/>calculateDamageInstance, enemy HP carried"]:::logic
      H1 --> H2["sorted by game time"]:::logic
    end
    subgraph Outs["per DPS window: Opener, First Loop, Avg Loop (3 reps), 2-Min"]
      direction TB
      O1["buildDpsStats: window damage / its length<br/>(loop windows null without a loop)"]:::logic
      O2["buildAllDmgOverTime: cumulative damage vs boss HP,<br/>kill time; Avg Loop folds its 3 reps per move"]:::logic
      O3["buildAllContribution: per unit (status ticks by name),<br/>per cast type, on-field time"]:::logic
      O4["buildSubstatWorth: 2-min hits re-priced with one substat<br/>± a min / default / max roll (no re-simulation)"]:::logic
      O5["buildEnergyRequirements: energyLog split at each Energy<br/>spend → ER needed, the bottleneck cast"]:::logic
      O1 ~~~ O2 ~~~ O3 ~~~ O4 ~~~ O5
    end
    subgraph Sum["summaryOnly"]
      direction TB
      Y1["buildRotationSummary:<br/>dpsStats + contribution"]:::logic
    end
    Ext --> Hits --> Outs
    Hits --> Sum
  `,
  resultsPanel: `
    graph LR
    subgraph Src["ResultsSource"]
      direction TB
      Q1{"inside a provider?"}
      Q1 -- no --> Q2["the Calculator: useRotationStore<br/>results + isStale, the roster,<br/>the pinned rotation"]:::store
      Q1 -- yes --> Q3["the Character Guide:<br/>its full calc, no pinning"]:::ui
    end
    subgraph Panel["ResultsPanel (a rail on step 1)"]
      direction TB
      T1["Results: DpsPanel (Δ vs the pin), DmgOverTimeChart<br/>(DMG / DPS, line / bar, pin overlay), RotationTimePanel,<br/>TeamContributionPanel, SubstatWorthChart"]:::ui
      T2["Timeline: coming soon"]:::ui
      T3["History: a HistoryRow per Calculate (10 kept + favorites)<br/>Restore Rotation (confirm): loadSavedRotation: setEnemy,<br/>await importTeam, importRotation · Pin to Comparison<br/>(instant) · Favorite, Export, Remove"]:::ui
      T1 ~~~ T2 ~~~ T3
    end
    subgraph Pin["PinRotationControl"]
      direction TB
      P1{"pin from"}
      P1 -->|"a rotation file"| P2["pinFromFile"]:::store
      P1 -->|"History"| P3["pinFromHistoryEntry<br/>(series already saved)"]:::store
      P1 -->|"Rankings"| P4["pinFromRankingEntry:<br/>loadRankedRun"]:::store
      P2 --> P5["runFullCalculation"]:::worker
      P4 --> P5
      P5 --> P6[("pinned: dpsStats + DMG over time<br/>(wuwa_calc_pinned_comparison)")]:::data
      P3 --> P6
    end
    Src --> Panel --> Pin
  `,
  resultsFiles: `
    graph LR
    subgraph Exp["Export Rotation (toolbar or History)"]
      direction TB
      E1["ExportRotationDialog: file names,<br/>author, results build"]:::ui
      E1 --> E2{"results build"}
      E2 -->|"Default"| E3["withDefaultBuild:<br/>recommendedEchoes per unit<br/>(sets, main echo, weapon kept),<br/>default enemy;<br/>runSummaryCalculation"]:::worker
      E2 -->|"Custom"| E4["current results if<br/>not stale, else<br/>runSummaryCalculation"]:::worker
      E3 --> E5
      E4 --> E5["buildExportFiles: hash of rotation +<br/>team + settings + enemy; a rotation file<br/>and a results file (dpsStats +<br/>contribution), both downloaded"]:::data
    end
    subgraph Repo["data repo"]
      direction TB
      R1["files committed to<br/>character_results/"]:::data
      R1 --> R2["generate-rankings-index: keeps<br/>Default-build results whose hash<br/>matches their rotation file"]:::data
    end
    subgraph Imp["Import Rotation"]
      direction TB
      I1["parse: a row array, or .rotation"]:::ui
      I1 --> I2{"file's team: same<br/>characters + sequences?"}
      I2 -- yes --> I3["ConfirmDialog: replace<br/>the build, or keep<br/>Step 1's"]:::ui
      I2 -- no --> I4
      I3 --> I4["applyImport: setEnemy,<br/>importTeam (unless kept),<br/>importRotation"]:::store
      I4 --> I5["importRotation: undo history<br/>cleared, ids + a blank last<br/>row, recalculate"]:::store
    end
    Exp --> Repo
    Repo ~~~ Imp
  `,
  builderOpen: `
    graph LR
    subgraph Lib["library"]
      direction TB
      L1["Characters, Weapons, Main Echoes,<br/>Echo Sets, System (searchable)"]:::ui
      L1 --> L2["dimmed: no mechanics file and no edits;<br/>! badge: hasChanges"]:::ui
    end
    subgraph Open["open (click)"]
      direction TB
      O1["checkBuilderItemFreshness"]:::data
      O1 --> O2["setActiveChar: DataLoader.loadMechanic<br/>(the pristine copy)"]:::data
      O2 --> O3{"a newer open<br/>started meanwhile?"}
      O3 -- yes --> O4["dropped"]:::alert
      O3 -- no --> O5["edit log replayed: base stats onto the<br/>live entry, edited nodes registered,<br/>deleted ones unregistered"]:::store
      O5 --> O6["working copy: baseStats + mechanics"]:::store
    end
    subgraph Ed["editor"]
      direction TB
      D1["node tables by kind<br/>character: BUILDER_CATEGORIES (Basic Attack … Resonance Chain)<br/>weapon: Weapon Passive · main echo: Echo Skill, Echo Passive<br/>set: 1-pc, 3-pc, or 2-pc + 5-pc Set Effect · System: System Mechanics"]:::ui
      D1 --> D2["a MechanicNodeCard per node (Hold / Repeat /<br/>Release grouped); Add Node from a template"]:::ui
      D2 --> D3["BaseStatsForm; JsonOutputPane: live JSON,<br/>edit inline, import / export, Reset Cache"]:::ui
    end
    Lib --> Open --> Ed
  `,
  builderEditLog: `
    graph LR
    subgraph Edits["edits"]
      direction TB
      E1["setMechanicNode: panels,<br/>JSON pane, Add Node"]:::ui
      E2["renameMechanicNode"]:::ui
      E3["removeMechanicNode,<br/>reorderMechanicNode"]:::ui
      E4["revertMechanicNode<br/>(NodeChangeBadge)"]:::ui
      E5["setBaseStat / setAllBaseStats"]:::ui
      E6["JSON import, Reset Cache"]:::ui
      E1 ~~~ E2 ~~~ E3 ~~~ E4 ~~~ E5 ~~~ E6
    end
    subgraph Log["useBuilderStore edit log (persisted)"]
      direction TB
      G1["editedMechanics: a node equal<br/>to its pristine copy is dropped"]:::store
      G2["deletedMechanicIds: removed and<br/>renamed-away ids; renamedFrom<br/>chains back to the original"]:::store
      G3["editedBaseStats: also written onto<br/>the live DataLoader entry"]:::store
      G4["revert: the pristine copy back<br/>(refused if its old id is taken)"]:::store
      G5["Reset Cache: clearMechanicCache,<br/>initDatabases, the entity's edits<br/>dropped, reopened"]:::store
      G1 ~~~ G2 ~~~ G3 ~~~ G4 ~~~ G5
    end
    subgraph Use["used by"]
      direction TB
      U1["DataLoader register / unregister<br/>(main thread, right away)"]:::data
      U2["hasChanges: ! badge, pickers enabled,<br/>a conflict dialog instead of a silent reload"]:::store
      U3["getTeamOverrides → buildBuilderPayload on<br/>every worker request; publishTeam<br/>replays them on the main thread"]:::worker
      U4["checkBuilderStaleness (Calculator mount):<br/>differs from the last Calculate → isStale"]:::alert
      U1 ~~~ U2 ~~~ U3 ~~~ U4
    end
    Edits --> Log --> Use
  `,
  dslCompile: `
    graph LR
    subgraph Split["DSLParser.compile(rule)"]
      direction TB
      C1{"shape"}
      C1 -->|"Event IF cond"| C2["trigger + condition"]
      C1 -->|"IF cond"| C3["ALWAYS + condition"]
      C1 -->|"Event"| C4["trigger; condition true"]
    end
    subgraph Trig["triggers"]
      direction TB
      T1{"ANY(a, b, …)?"}
      T1 -- yes --> T2["a trigger each"]:::logic
      T1 -- no --> T3["one trigger"]:::logic
      T2 --> T4
      T3 --> T4["_parseTrigger: Event, (args), [tags]<br/>(lowercased; @Owner(Move) kept whole)"]:::logic
    end
    subgraph Cond["condition → JavaScript"]
      direction TB
      K1["_resolveLogicalWrappers:<br/>ANY / ALL / XOR / NOT"]:::logic
      K1 --> K2["x == a..b → a range check"]:::logic
      K2 --> K3["_translatePointers: MATH() unwrapped, @StatusMult,<br/>ABS, % → / 100, @Owner(Move) → a key string,<br/>@Self / @Move / @Enemy … → ctx paths,<br/>.BuffStacks(x) → .getBuffStacks('x'), suffixes"]:::logic
      K3 --> K4["AND / OR / NOT → && / || / !"]:::logic
      K4 --> K5["new Function(ctx, equipper, statusMult);<br/>a compile or run-time error reads false"]:::logic
      K6["evaluateMath: the same translation,<br/>cached per expression"]:::logic
      K5 ~~~ K6
    end
    Split --> Trig --> Cond
  `,
  dslVocabulary: `
    graph TD
    Vocab["data/gameVocab.ts<br/>elements, cast types, negative statuses, stat keys"]:::data
    Vocab --> Reg["dslRegistry.ts (shapes in dslTypes.ts)<br/>DSL_EVENTS, DSL_MODIFIERS, DSL_POINTERS (@Self, @Move, @Prev ...),<br/>properties: targetKey / fullOverride / jsName for methods,<br/>type methods, MATH functions, StatusMult, tooltips"]:::logic
    Vocab --> CReg["combat/combatRegistry<br/>scopes, multiplier bucket rules, mod labels"]:::logic
    Reg --> Parser["dslParser: pointer + scalar translation maps,<br/>method rules; checks the registry at load"]:::logic
    Parser --> Compile["compile(rule), evaluateMath(expr)"]:::logic
    Compile --> Engine["EventManager, TimelineEngine, RotationRow<br/>(trigger rules, hit mults, priority)"]:::logic
    Reg --> Resolver["dslResolver: MatchRule factories<br/>pointers, properties, method chains, MATH,<br/>@Namespace(Move) brackets, cooldown refs"]:::logic
    Bmech["Builder mechanics + base stats<br/>(names, effect ids, forte aliases)"]:::store --> Resolver
    CReg --> Resolver
    Resolver --> AC["AutocompleteInput modes: general, dsl-value, eff-name,<br/>eff-target, eff-applies-during, eff-stat, eff-cd-name;<br/>tooltips, DSLHighlight.tokenizeDSL"]:::ui
    CReg --> SP["combat/statParser"]:::logic
    SP --> Calc["CombatCalculator.aggregateBuffTotals"]:::logic
  `,
  rankingsList: `
    graph LR
    subgraph Load["useRankingsStore.load (mount, tab focus)"]
      direction TB
      L1["checkResultsFreshness<br/>(index changed: reset, reload)"]:::data
      L1 --> L2{"already loading<br/>or ready?"}
      L2 -- yes --> L3["done"]
      L2 -- no --> L4["DataLoader.loadRankingIndex:<br/>character_results/index.json"]:::data
      L4 --> L5["a RankingEntry per row: team,<br/>sequences, rotation type, author,<br/>dpsStats, contribution"]:::store
    end
    subgraph Filter["filterRankingEntries"]
      direction TB
      F1["sequence range per slot<br/>(4-star units skip it)"]:::store
      F1 --> F2["rotation style, search"]:::store
      F2 --> F3["DMG type: the team's majority element /<br/>category (only when narrowed)"]:::store
      F3 --> F4["Best Only: the best per<br/>characters + sequences"]:::store
      F4 --> F5["sorted by the window's DPS; paged<br/>(back to page 1 on a change)"]:::store
    end
    subgraph Row["RankingRow"]
      direction TB
      W1["TeamPreview + StackedContributionBar"]:::ui
      W2["Open in Rotation Calculator: loadRankedRun,<br/>loadSavedRotation, #/calculator/step-2"]:::store
      W3["Pin to Comparison: pinFromRankingEntry,<br/>then the calculator"]:::store
      W4["Open Name Guide: #/guide/Name"]:::ui
      W5["expand: RankingTimelinePanel<br/>(next diagram)"]:::ui
      W1 ~~~ W2 ~~~ W3 ~~~ W4 ~~~ W5
    end
    Load --> Filter --> Row
  `,
  rankingsTimeline: `
    graph LR
    subgraph Data["useRotationTimelineData(entry)"]
      direction TB
      D1["DataLoader.loadRankedRun: results file<br/>(team, enemy) + rotation file (rows,<br/>settings); a hash mismatch only warns"]:::data
      D1 --> D2["buildCalcRequest →<br/>postToWorker(recalculate)"]:::worker
      D2 --> D3{"still the latest<br/>request?"}
      D3 -- no --> D4["ignored"]:::alert
      D3 -- yes --> D5["evaluatedRows +<br/>loopStartIndex"]:::worker
    end
    subgraph Layout["RotationTimeline (timelineLayout.ts)"]
      direction TB
      T1["buildTimeCompression: the Ending Rotation's<br/>simulated gap squeezed to a fixed width"]:::logic
      T1 --> T2["buildUnitRows: a lane per unit,<br/>a clip per move (50 px per second)"]:::logic
      T2 --> T3["buildFlags + assignFlagLanes: inputs and<br/>swaps, laned so labels don't overlap<br/>(hidden when Show Inputs is off)"]:::logic
      T3 --> T4["generateTicks; loop start, loop end<br/>and ending markers"]:::logic
    end
    subgraph Draw["drawn (also the Guide's timeline)"]
      direction TB
      R1["TimelineRuler, TimelineFlagTrack,<br/>TimelineRow + TimelineClip;<br/>zoomed as a whole by useUiScale"]:::ui
    end
    Data --> Layout --> Draw
  `,
  guideJobs: `
    graph LR
    subgraph Page["page"]
      direction TB
      G1["#/guide: GuideLibrary; characters<br/>with no ranked rotation dimmed"]:::ui
      G1 --> G2["#/guide/Name: useRankingsStore.load;<br/>useGuideEntries: loadRankedRun for each entry<br/>with the unit (failures left out)"]:::data
      G2 --> G3["groupTeams: a group per team +<br/>rotation style, best S0 DPS first"]:::logic
    end
    subgraph Cfg["config"]
      direction TB
      C1{"saved selection still valid?<br/>(wuwa_guide_selection)"}
      C1 -- yes --> C2["saved config, rank range,<br/>added weapons, Show Inputs"]:::store
      C1 -- no --> C3["defaultConfig: best Linear team (else<br/>any) at S0R1; 4-stars keep theirs"]:::store
      C4["changed by: Team Setup, picking a<br/>comparison row, Show in Guide<br/>(configFromEntry)"]:::ui
      C2 ~~~ C4
    end
    subgraph Jobs["guideView → jobs"]
      direction TB
      J1["jobForConfig: the chosen set build's submissions;<br/>pickRotationEntry: highest sequence ≤ the selection<br/>(else the lowest); buildTeam applies sequence,<br/>weapon, rank, echo build"]:::logic
      J1 --> J2["selected + comparison rows: S0–S6; echo builds<br/>43311 ×3, 44111, 41111 (+ submitted); set builds<br/>(if 2+); weapons (team's, added, selected) at<br/>each end of the rank range"]:::logic
      J2 --> J3["+ the default view's jobs; a job key =<br/>what would calculate differently"]:::logic
    end
    Page --> Cfg --> Jobs
  `,
  guideRun: `
    graph LR
    subgraph Cache["useGuideCache (on open)"]
      direction TB
      A1["loadGuideCache: IndexedDB<br/>wuwa-calc / guide-cache"]:::data
      A1 --> A2["readDeps: calc version; content version<br/>of runs, databases, mechanics (+ WIP);<br/>Builder edit hashes"]:::data
      A2 --> A3{"changedDeps?"}
      A3 -- yes --> A4["saved results dropped"]:::alert
      A3 -- no --> A5["restored into the summary<br/>+ full caches"]:::store
    end
    subgraph Run["calcs (after the check)"]
      direction TB
      R1["useGuideFullCalc(selected): cached → shown;<br/>else runFullCalculation (main lane), also filling<br/>its summary; old results dimmed meanwhile"]:::worker
      R1 --> R2["useGuideSummaries(all jobs): skips cached /<br/>failed, shares in-flight; runSummaryCalculation<br/>on the pool, cancelled once unwanted"]:::worker
    end
    subgraph Save["save (1 s after results land)"]
      direction TB
      S1["readDeps again"]:::data
      S1 --> S2{"changed since they<br/>were calculated?"}
      S2 -- yes --> S3["saving stops<br/>for this visit"]:::alert
      S2 -- no --> S4["saveGuideCache: last 20 full runs,<br/>400 summaries; rows trimmed,<br/>no DMG over time"]:::data
    end
    subgraph Shown["shown"]
      direction TB
      U1["Team Setup, EchoStatsPanel (Required ER),<br/>Results panels via ResultsSourceContext,<br/>RotationTimeline"]:::ui
      U2["Comparisons: metricValue DPS / DPR,<br/>Team / Personal, % of the selected;<br/>GuideRankings"]:::ui
      U1 ~~~ U2
    end
    Cache --> Run --> Save
    Run --> Shown
  `,
  dataLoading: `
    graph LR
    subgraph Src["data sources"]
      direction TB
      Gen["data repo Action (a push touching data JSON):<br/>generate-rankings-index, then generate-manifest<br/>(path → content hash), committed"]:::data --> Repo
      Repo[("<b>wuwa-calc-data</b><br/>data/: db_*.json, manifest.json<br/>data/mechanics/: characters, weapons, sets, echoes, system<br/>data/character_results/: rotations/, results/, index.json<br/>images/")]:::data
      Wip[("/wip-data: dev only, gitignored;<br/>files under test")]:::data
      Repo ~~~ Wip
    end
    subgraph Loader["DataLoader.loadJSON(path)"]
      direction TB
      L1{"manifest loaded and<br/>lacks the file?"}
      L1 -- "yes, not WIP" --> L2["skipped (no 404)"]:::data
      L1 -- no --> L3{"a dev WIP path?"}
      L3 -- yes --> L4["/wip-data first; missing → the repo<br/>(served from WIP: no freshness baseline)"]:::data
      L3 -- no --> L5["fetched with ?v=its manifest hash<br/>(browser-cached until it changes)"]:::data
      L4 --> L6["loadedHashes[path] = manifest hash"]:::data
      L5 --> L6
    end
    subgraph Users["built on it"]
      direction TB
      U1["loadMergedDB: db files; a WIP<br/>copy merges over the real one"]:::data
      U2["loadMechanic: cached per entity; a missing<br/>file retries after 30 s; live nodes +<br/>pristine copies registered"]:::data
      U3["loadRankingIndex; loadRankedRun<br/>(results + rotation file)"]:::data
      U1 ~~~ U2 ~~~ U3
    end
    Src -->|"fetch"| Loader --> Users
  `,
  dataFreshness: `
    graph LR
    subgraph Trig["triggers"]
      direction TB
      T1["checkTeamFreshness: every recalculate /<br/>Calculate, buildCalcRequest,<br/>calculator tab focus"]:::ui
      T2["checkBuilderItemFreshness: opening an<br/>entity, page load, Builder tab focus,<br/>3 s poll"]:::ui
      T1 ~~~ T2
    end
    subgraph Check["checkItems, per entity"]
      direction TB
      C0["refreshManifest<br/>(at most every 5 s)"]:::data
      C0 --> C1{"loaded, not from WIP,<br/>in the manifest?"}
      C1 -- no --> C2["skipped"]
      C1 -- yes --> C3{"loaded hash vs manifest"}
      C3 -->|"none yet"| C4["adopts the<br/>manifest's"]:::data
      C3 -->|"same"| C2
      C3 -->|"different"| C5{"unsaved Builder<br/>edits to it?"}
    end
    subgraph Outcome["changed"]
      direction TB
      O1["no edits: clearMechanicCache + loadMechanic;<br/>returned as staleRefs, so the worker<br/>drops its copy too"]:::data
      O2["edits: FreshnessConflictDialog"]:::alert
      O2 --> O3["Keep My Edits: nothing changes<br/>(asked again next check)"]:::store
      O2 --> O4["Discard & Use Latest: discardChanges,<br/>clearMechanicCache, reopened if open"]:::store
      O1 ~~~ O2
    end
    Trig --> Check --> Outcome
  `,
  dataResultsCache: `
    graph LR
    subgraph Rank["checkResultsFreshness<br/>(Rankings / guide load, tab focus)"]
      direction TB
      K1{"index.json changed?"}
      K1 -- yes --> K2["index + every run cleared;<br/>the list reloads"]:::store
      K1 -- no --> K3["runs whose results or rotation file<br/>changed dropped (re-fetched when opened)"]:::data
    end
    subgraph Guide["Character Guide cache"]
      direction TB
      G1{"changedDeps when<br/>restoring?"}
      G1 -- yes --> G2["saved results dropped,<br/>recalculated"]:::alert
      G1 -- no --> G3["restored"]:::store
      G4["a change during the visit: results<br/>stay on screen, saving stops"]:::alert
      G3 ~~~ G4
    end
    Rank ~~~ Guide
  `,
  dataPersistence: `
    graph LR
    LSt[("<b>localStorage</b> via safeLocalStorage (quota errors swallowed)<br/>wuwa_calc_team_cache: team + enemy<br/>wuwa_calc_rotation_cache: rows, undo + redo, settings, last results<br/>wuwa_builder_cache: Builder edit log<br/>wuwa_calc_rotation_history: Calculate history<br/>wuwa_calc_pinned_comparison: pinned rotation<br/>wuwa_rankings_ui_cache: filters, page, window<br/>wuwa_guide_selection: guide config per character<br/>wuwa_calc_last_step, wuwa_calc_last_guide_character")]:::data
    IDB[("<b>IndexedDB</b> via idbStore (failures read as empty)<br/>wuwa-calc / guide-cache: guide results per character")]:::data
    Push["push to main"]:::data --> CI["GitHub Actions: npm ci, npm run build<br/>(tsc -b + vite build; virtual:calc-version<br/>hashes src/**/*.ts for the guide cache)"]:::data
    CI --> Pages["GitHub Pages"]:::data
    Pages --> SWn["service worker: cache-first for assets and<br/>repo images, network-first for index.html<br/>(bump CACHE_VERSION to evict)"]:::data
    LSt ~~~ IDB
  `
};
