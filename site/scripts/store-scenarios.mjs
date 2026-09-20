// Store-level scenarios for scripts/engine-check.mjs: drives the real Zustand stores (rotation,
// roster, builder) plus the real calc worker pipeline under Node, and snapshots the state after
// every step. Refactors of src/store/*, src/systems/HistoryManager.ts and src/workers/* must not
// change any of it.
//
//   - The worker is faked as an in-process bridge: `calc.worker.ts?worker` resolves to a stand-in
//     `Worker` whose postMessage runs the actual worker module's onmessage handler (structured
//     clone both ways, like a real postMessage), so recalculate()/calculateDamage() run for real.
//   - crypto.randomUUID is a counter, and every id in a snapshot is renumbered by first appearance,
//     so a refactor that draws ids in a different order (but the same amount of them) is invisible.
//   - Each step records what it did to the store; a step that throws records the message instead.

const bridge = { listeners: new Set(), inFlight: 0, deliver: null };
globalThis.__calcBridge = bridge;

export const storeHarnessPlugin = {
  name: 'store-harness-fake-calc-worker',
  enforce: 'pre',
  resolveId(id) {
    if (/calc\.worker\.ts\?worker$/.test(id)) return '\0fake-calc-worker';
  },
  load(id) {
    if (id !== '\0fake-calc-worker') return;
    return `export default class FakeWorker {
      addEventListener(type, fn) { globalThis.__calcBridge.listeners.add(fn); }
      removeEventListener(type, fn) { globalThis.__calcBridge.listeners.delete(fn); }
      postMessage(message) { globalThis.__calcBridge.deliver(message); }
      terminate() {}
    }`;
  }
};

const ID_PATTERN = /uuid-\d{6}/g;

// Renumbers every stub uuid by order of first appearance.
function normalizeIds(value) {
  const seen = new Map();
  const text = JSON.stringify(value).replace(ID_PATTERN, m => {
    if (!seen.has(m)) seen.set(m, `id#${seen.size}`);
    return seen.get(m);
  });
  return JSON.parse(text);
}

export async function snapshotStores({ server, canon, mulberry32, generateRotation }) {
  const out = {};
  const load = url => server.ssrLoadModule(url);

  // -- environment ----------------------------------------------------------------------------
  let uuidCounter = 0;
  const realRandomUUID = globalThis.crypto.randomUUID;
  globalThis.crypto.randomUUID = () => `uuid-${String(++uuidCounter).padStart(6, '0')}`;
  const realRandom = Math.random;
  Math.random = mulberry32(4242);
  const original = { warn: console.warn, error: console.error, log: console.log, info: console.info };
  console.warn = console.error = console.log = console.info = () => {};

  const workerSelf = {
    onmessage: null,
    postMessage: message => {
      const data = structuredClone(message);
      queueMicrotask(() => {
        bridge.inFlight--;
        bridge.listeners.forEach(fn => fn({ data }));
      });
    }
  };
  globalThis.self = workerSelf;
  bridge.deliver = message => {
    bridge.inFlight++;
    const data = structuredClone(message);
    queueMicrotask(() => workerSelf.onmessage({ data }));
  };

  try {
    // The vocab/DSL probes that ran before this may already have loaded the stores (created under the
    // real crypto.randomUUID) and DataLoader; start every module over so this run is self-contained.
    (server.environments?.ssr?.moduleGraph ?? server.moduleGraph).invalidateAll();
    await load('/src/workers/calc.worker.ts');
    const { DataLoader } = await load('/src/utils/DataLoader.ts');
    await DataLoader.initDatabases();
    const rosterModule = await load('/src/store/useRosterStore.ts');
    const rotationModule = await load('/src/store/useRotationStore.ts');
    const builderModule = await load('/src/store/useBuilderStore.ts');
    const historyModule = await load('/src/store/useRotationHistoryStore.ts');
    const { runFullCalculation } = await load('/src/workers/runFullCalculation.ts');
    const { useRosterStore } = rosterModule;
    const { useRotationStore } = rotationModule;
    const { useBuilderStore } = builderModule;

    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    // Everything the stores kick off (worker round trips, freshness checks, mechanic loads) runs
    // on the microtask queue, so a macrotask boundary means it has all landed.
    const settle = async () => {
      for (let i = 0; i < 30; i++) {
        await tick();
        if (bridge.inFlight === 0 && !useRotationStore.getState().isCalculating) {
          await tick();
          if (bridge.inFlight === 0 && !useRotationStore.getState().isCalculating) return;
        }
      }
    };

    const roster = () => useRosterStore.getState();
    const rot = () => useRotationStore.getState();
    const builder = () => useBuilderStore.getState();

    const lightRow = r => ({
      id: r.id, unit: r.unit, action: r.action, timing: r.timing, offset: r.offset, manualOffset: r.manualOffset,
      loopStartOverride: r.loopStartOverride, loopEndOverride: r.loopEndOverride,
      repeatBlockStart: r.repeatBlockStart, repeatCount: r.repeatCount, repeatBlockEnd: r.repeatBlockEnd, repeatFinalTiming: r.repeatFinalTiming
    });
    // A serialized command carries whole rows (a Delete keeps the evaluated row it removed); keep
    // just their authored fields here -- the evaluated state is covered by the full snapshots.
    const lightStack = value => {
      if (Array.isArray(value)) return value.map(lightStack);
      if (!value || typeof value !== 'object') return value;
      const result = {};
      for (const [key, inner] of Object.entries(value)) {
        if ((key === 'newRow' || key === 'row') && inner && typeof inner === 'object') result[key] = lightRow(inner);
        else if (key === 'previousRowsSnapshot') result[key] = inner.map(lightRow);
        else result[key] = lightStack(inner);
      }
      return result;
    };
    const rotationView = (full = false) => {
      const s = rot();
      return {
        rows: full ? s.rows : s.rows.map(lightRow),
        selectedIndices: s.selectedIndices, clipboard: s.clipboard,
        canUndo: s.canUndo, canRedo: s.canRedo,
        undoStackData: lightStack(s.undoStackData), redoStackData: lightStack(s.redoStackData),
        loopStartIndex: s.loopStartIndex, loopStartIsOverride: s.loopStartIsOverride, loopErrors: s.loopErrors, loopWarnings: s.loopWarnings,
        startEnergy: s.startEnergy, startConcerto: s.startConcerto,
        endingRotationEnabled: s.endingRotationEnabled, endRotationStartsEarlier: s.endRotationStartsEarlier,
        isStale: s.isStale, hasResults: !!s.results
      };
    };
    const rosterView = () => ({ team: roster().team, enemy: roster().enemy });
    const builderView = () => {
      const s = builder();
      return {
        activeChar: s.activeChar, activeFolder: s.activeFolder, activeRarity: s.activeRarity,
        baseStats: s.baseStats, mechanicKeys: Object.keys(s.mechanics),
        openPanelByNode: s.openPanelByNode, renamedFrom: s.renamedFrom,
        editedBaseStats: s.editedBaseStats, editedMechanics: s.editedMechanics, deletedMechanicIds: s.deletedMechanicIds
      };
    };

    // Records `view()` after `fn` runs (and the pipeline settles); a throw is recorded instead.
    const step = async (bucket, name, fn, view) => {
      let record;
      try {
        const returned = await fn();
        await settle();
        record = { returned: returned === undefined ? null : returned, state: view() };
      } catch (err) {
        await settle();
        record = { threw: err?.message ?? String(err) };
      }
      out[`${bucket}/${name}`] = normalizeIds(canon(record));
    };

    const roster_ = (name, fn) => step('roster', name, fn, rosterView);
    const rotation_ = (name, fn, full = false) => step('rotation', name, fn, () => rotationView(full));
    const builder_ = (name, fn) => step('builder', name, fn, builderView);

    const movesOf = owner => (DataLoader.mechanicsIndex[owner] || []).filter(k => DataLoader.mechanicsDB[k] && !DataLoader.mechanicsDB[k].isPassive);

    // ============================================================================================
    // Roster store
    // ============================================================================================
    await roster_('start', () => null);
    await roster_('char0', () => roster().setSlotField(0, 'character', 'Lumi'));
    await roster_('char1', () => roster().setSlotField(1, 'character', 'Sanhua'));
    await roster_('char2', () => roster().setSlotField(2, 'character', 'Youhu'));
    await roster_('weapon', () => roster().setSlotField(0, 'weapon', 'Radiance Cleaver'));
    await roster_('rank', () => roster().setSlotField(0, 'rank', 3));
    await roster_('sequence', () => roster().setSlotField(1, 'sequence', 2));
    await roster_('mode', () => roster().setSlotField(1, 'mode', 'Alt'));
    await roster_('mainSet-void', () => roster().setSlotField(0, 'mainSet', 'Void Thunder'));
    await roster_('mainEcho-nm', () => roster().setSlotField(0, 'mainEcho', 'NM Thundering Mephis'));
    await roster_('mainSet-drops-mismatched-echo', () => roster().setSlotField(0, 'mainSet', 'Moonlit Clouds'));
    await roster_('subSet', () => roster().setSlotField(1, 'subSet', 'Void Thunder'));
    await roster_('subSet2a', () => roster().setSlotField(1, 'subSet2a', 'Moonlit Clouds'));
    await roster_('subSet2b', () => roster().setSlotField(1, 'subSet2b', 'Void Thunder'));
    for (const onePc of (DataLoader.onePcSets || []).slice(0, 1)) {
      await roster_('mainSet-1pc', () => roster().setSlotField(2, 'mainSet', onePc));
    }
    await roster_('layout', () => roster().setSlotField(0, 'layout', '4 4 1 1 1'));
    await roster_('layout-back', () => roster().setSlotField(0, 'layout', '4 3 3 1 1'));
    await roster_('layout-unknown', () => roster().setSlotField(0, 'layout', 'nonsense'));
    await roster_('substat', () => roster().setSubstat(0, 1, 2, 'Crit. Rate', 8.1));
    await roster_('substat-na', () => roster().setSubstat(0, 1, 3, 'N/A', ''));
    await roster_('enemy', () => roster().setEnemyField('level', 95));
    await roster_('build-apply', () => roster().applyRecommendedBuild(1, 'Lumi'));
    await roster_('build-missing', () => roster().applyRecommendedBuild(1, 'Nobody At All'));
    await roster_('clearSlot', () => roster().clearSlot(2));
    await roster_('importTeam-partial', () => roster().importTeam([
      { character: 'Youhu', sequence: 1, mainSet: 'Void Thunder', subSet2a: 'Moonlit Clouds', mainEcho: 'Impermanence Heron' },
      undefined,
      { character: 'Youhu', weapon: '', sequence: 3 }
    ]));
    await roster_('importTeam-not-array', () => roster().importTeam('nope'));
    for (let i = 0; i < 3; i++) {
      await roster_(`idleStats-${i}`, () => roster().getIdleStats(i));
    }
    // Put the standard three-unit team back for the rotation scenarios below.
    await roster_('reset-team', async () => {
      await roster().clearSlot(0); await roster().clearSlot(1); await roster().clearSlot(2);
      await roster().setSlotField(0, 'character', 'Lumi');
      await roster().setSlotField(1, 'character', 'Sanhua');
      await roster().setSlotField(2, 'character', 'Youhu');
      await roster().setEnemyField('level', 90);
    });
    await roster_('idleStats-final-0', () => roster().getIdleStats(0));
    await roster_('idleStats-final-1', () => roster().getIdleStats(1));
    await roster_('idleStats-final-2', () => roster().getIdleStats(2));

    // Persisted shape, and a fresh store instance rehydrating from it.
    out['roster/persisted'] = normalizeIds(canon(JSON.parse(localStorage.getItem('wuwa_calc_team_cache') || 'null')));

    // ============================================================================================
    // Rotation store
    // ============================================================================================
    const team = roster().team.map(s => JSON.parse(JSON.stringify(s)));
    const base = generateRotation(DataLoader, team, 7, 26).slice(0, 26);
    const rowsToImport = base.map(({ unit, action, timing }) => ({ unit, action, timing }));
    const lumiMoves = movesOf('Lumi');
    const sanhuaMoves = movesOf('Sanhua');

    await rotation_('start', () => null);
    await rotation_('import', () => rot().importRotation(rowsToImport, { startEnergy: true, startConcerto: false }), true);
    await rotation_('import-empty', () => rot().importRotation([]));
    await rotation_('import-again', () => rot().importRotation(rowsToImport, { startEnergy: true, endingRotationEnabled: false }));

    await rotation_('addRow-end', () => rot().addRow('Lumi', lumiMoves[1]));
    await rotation_('addRow-index', () => rot().addRow('Sanhua', sanhuaMoves[0], 2));
    await rotation_('addRow-default', () => rot().addRow());
    await rotation_('select-insertAbove', () => { rot().setSelectedIndices([4, 5]); return rot().insertRowAboveSelection(); });
    await rotation_('select-insertBelow', () => { rot().setSelectedIndices([4, 5]); return rot().insertRowBelowSelection(); });
    await rotation_('insert-no-selection', () => { rot().setSelectedIndices([]); return [rot().insertRowAboveSelection(), rot().insertRowBelowSelection()]; });

    await rotation_('edit-unit', () => rot().updateRowField(3, 'unit', 'Sanhua'));
    await rotation_('edit-noop', () => rot().updateRowField(3, 'unit', 'Sanhua'));
    await rotation_('edit-action-carries-unit', () => {
      const last = rot().rows.length - 1;
      rot().updateRowField(last - 1, 'unit', 'Lumi');
      return rot().updateRowField(last - 1, 'action', lumiMoves[0]);
    });
    await rotation_('edit-timing', () => rot().updateRowField(6, 'timing', 'Full'));
    await rotation_('edit-fields', () => rot().updateRowFields(7, { offset: 5, manualOffset: 5 }));
    await rotation_('edit-fields-noop', () => rot().updateRowFields(7, { offset: 5, manualOffset: 5 }));
    await rotation_('edit-fields-missing-row', () => rot().updateRowFields(999, { offset: 1 }));
    await rotation_('setRowUnit-last', () => rot().setRowUnit(rot().rows.length - 1, 'Youhu'));
    await rotation_('setRowUnit-mid', () => rot().setRowUnit(9, 'Sanhua'));
    await rotation_('setRowUnit-noop', () => rot().setRowUnit(9, 'Sanhua'));

    await rotation_('delete', () => rot().deleteRows([10, 11]));
    await rotation_('delete-out-of-range', () => rot().deleteRows([500]));
    await rotation_('move', () => rot().moveRows([5], 12));
    await rotation_('move-multi', () => rot().moveRows([2, 3], 15));
    await rotation_('copy', () => { rot().setSelectedIndices([2, 3, 4]); return rot().copySelectedRows(); });
    await rotation_('copy-last-row-ignored', () => { rot().setSelectedIndices([rot().rows.length - 1]); return rot().copySelectedRows(); });
    await rotation_('paste-no-selection', () => { rot().setClipboard([{ unit: 'Lumi', action: lumiMoves[0], timing: 'Auto' }, { unit: 'Sanhua', action: sanhuaMoves[0], timing: 'Swap' }]); rot().setSelectedIndices([]); return rot().pasteRows(); });
    await rotation_('paste-overwrite', () => { rot().setSelectedIndices([1, 2]); return rot().pasteRows(); });
    await rotation_('paste-fewer-than-selected', () => { rot().setClipboard([{ unit: 'Lumi', action: lumiMoves[2], timing: 'Cancel' }]); rot().setSelectedIndices([3, 4, 5]); return rot().pasteRows(); });
    await rotation_('paste-more-than-selected', () => {
      rot().setClipboard([lumiMoves[0], lumiMoves[1], lumiMoves[2]].map(action => ({ unit: 'Lumi', action, timing: 'Auto' })));
      rot().setSelectedIndices([6]);
      return rot().pasteRows();
    });
    await rotation_('paste-empty-clipboard', () => { rot().setClipboard([]); return rot().pasteRows(); });

    // Loop + repeat markers
    await rotation_('loopStart', () => rot().setLoopStartOverride(3));
    await rotation_('loopStart-same', () => rot().setLoopStartOverride(3));
    await rotation_('loopStart-empty-row', () => rot().setLoopStartOverride(rot().rows.length - 1));
    await rotation_('loopStart-reset', () => rot().resetLoopStart());
    await rotation_('loopStart-reset-none', () => rot().resetLoopStart());
    await rotation_('loopStart-again', () => rot().setLoopStartOverride(2));
    await rotation_('loopEnd', () => rot().setLoopEndOverride(14));
    await rotation_('loopEnd-same', () => rot().setLoopEndOverride(14));
    await rotation_('repeat-add', () => rot().addRepeatBlock(5, 7), true);
    await rotation_('repeat-add-bad-order', () => rot().addRepeatBlock(9, 8));
    await rotation_('repeat-add-crosses-loop', () => rot().addRepeatBlock(1, 4));
    const groupId = () => rot().rows.find(r => r.repeatBlockStart !== undefined)?.repeatBlockStart;
    await rotation_('repeat-count', () => rot().setRepeatCount(groupId(), 3));
    await rotation_('repeat-count-clamp', () => rot().setRepeatCount(groupId(), -4.7));
    await rotation_('repeat-count-same', () => rot().setRepeatCount(groupId(), 1));
    await rotation_('repeat-count-unknown-group', () => rot().setRepeatCount('nope', 3));
    await rotation_('repeat-final-timing', () => rot().setRepeatFinalTiming(groupId(), 'Full'));
    await rotation_('repeat-final-timing-clear', () => rot().setRepeatFinalTiming(groupId(), undefined));
    await rotation_('repeat-final-timing-again', () => rot().setRepeatFinalTiming(groupId(), 'Swap'));
    await rotation_('repeat-start-move', () => rot().setRepeatBlockStartIndex(groupId(), 4));
    await rotation_('repeat-start-past-end', () => rot().setRepeatBlockStartIndex(groupId(), 12));
    await rotation_('repeat-end-move', () => rot().setRepeatBlockEndIndex(groupId(), 8));
    await rotation_('repeat-end-before-start', () => rot().setRepeatBlockEndIndex(groupId(), 1));
    await rotation_('repeat-copy-paste', () => {
      rot().setSelectedIndices([4, 5, 6, 7, 8]);
      rot().copySelectedRows();
      rot().setSelectedIndices([]);
      return rot().pasteRows();
    }, true);
    await rotation_('repeat-delete-start-row', () => rot().deleteRows([4]));
    await rotation_('repeat-delete-end-row', () => { const g = groupId(); return rot().deleteRows([rot().rows.findIndex(r => r.repeatBlockEnd === g)]); });
    await rotation_('repeat-remove', () => rot().removeRepeatBlock(groupId()));
    await rotation_('repeat-remove-all', () => { for (let i = 0; i < 4 && groupId(); i++) rot().removeRepeatBlock(groupId()); });
    await rotation_('repeat-single-row-block', () => rot().addRepeatBlock(6, 6));
    await rotation_('repeat-delete-single-row-block', () => rot().deleteRows([6]));

    // Ending rotation
    await rotation_('ending-on', () => rot().setEndingRotationEnabled(true), true);
    await rotation_('ending-earlier', () => rot().setEndRotationStartsEarlier(true));
    await rotation_('ending-off', () => rot().setEndingRotationEnabled(false));
    await rotation_('ending-earlier-while-off', () => rot().setEndRotationStartsEarlier(true));
    await rotation_('ending-on-with-repeat', () => { rot().addRepeatBlock(2, 3); return rot().setEndingRotationEnabled(true); }, true);
    await rotation_('ending-off-with-repeat', () => rot().setEndingRotationEnabled(false));

    // Settings
    await rotation_('startEnergy-off', () => rot().setStartEnergy(false));
    await rotation_('startConcerto-on', () => rot().setStartConcerto(true));
    await rotation_('startEnergy-on', () => { rot().setStartEnergy(true); rot().setStartConcerto(false); });

    // Calculate: rows + Results, plus the History entry it records.
    await rotation_('calculate', async () => {
      await rot().calculateDamage();
      const last = historyModule.useRotationHistoryStore.getState().entries?.[0];
      return last ? { historyKeys: Object.keys(last).sort(), historyTeamSlots: last.team.length, historyRotation: last.rotation, historySettings: last.settings } : 'no history entry';
    }, true);
    out['rotation/results'] = normalizeIds(canon(rot().results));
    await rotation_('calculate-with-repeat', async () => { rot().addRepeatBlock(3, 4); await rot().calculateDamage(); }, true);
    out['rotation/results-with-repeat'] = normalizeIds(canon(rot().results));
    await rotation_('recalculate-with-damage', () => rot().recalculate(false, true), true);
    await rotation_('recalculate-plain', () => rot().recalculate());
    await rotation_('staleness', () => { rot().setStale(false); rot().checkBuilderStaleness(); return rot().isStale; });

    // Same pipeline, through the one-shot helper Rankings/Comparison use.
    const shared = await runFullCalculation(
      rot().rows.map(r => ({ unit: r.unit, action: r.action, timing: r.timing, ...(r.repeatBlockStart !== undefined ? { repeatBlockStart: r.repeatBlockStart, repeatCount: r.repeatCount } : {}), ...(r.repeatBlockEnd !== undefined ? { repeatBlockEnd: r.repeatBlockEnd } : {}), ...(r.loopStartOverride ? { loopStartOverride: true } : {}) })),
      roster().team, { startEnergy: true, startConcerto: false }, false, false
    );
    out['rotation/runFullCalculation'] = normalizeIds(canon(shared));

    // Undo all the way down, then redo all the way back up.
    let undoSteps = 0;
    while (rot().canUndo && undoSteps < 200) {
      await rotation_(`undo-${String(undoSteps).padStart(3, '0')}`, () => rot().undo());
      undoSteps++;
    }
    let redoSteps = 0;
    while (rot().canRedo && redoSteps < 200) {
      await rotation_(`redo-${String(redoSteps).padStart(3, '0')}`, () => rot().redo());
      redoSteps++;
    }
    out['rotation/undo-redo-counts'] = { undoSteps, redoSteps };

    // Persisted shape, and a fresh store instance rehydrating from it (revives the command stacks).
    const persisted = JSON.parse(localStorage.getItem('wuwa_calc_rotation_cache') || 'null');
    out['rotation/persisted'] = normalizeIds(canon({
      ...persisted,
      state: { ...persisted.state, results: persisted.state.results ? '(results)' : null, undoStackData: lightStack(persisted.state.undoStackData), redoStackData: lightStack(persisted.state.redoStackData) }
    }));
    const rotationUrl = '/src/store/useRotationStore.ts';
    const graph = server.environments?.ssr?.moduleGraph ?? server.moduleGraph;
    const node = await graph.getModuleByUrl(rotationUrl);
    if (node) graph.invalidateModule(node);
    const revived = await load(rotationUrl);
    const rev = () => revived.useRotationStore.getState();
    const revivedView = () => ({ ...{ rows: rev().rows.map(lightRow) }, canUndo: rev().canUndo, canRedo: rev().canRedo, undoStackData: lightStack(rev().undoStackData), redoStackData: lightStack(rev().redoStackData), loopStartIndex: rev().loopStartIndex });
    out['rotation/rehydrated'] = normalizeIds(canon(revivedView()));
    for (let i = 0; i < 3 && rev().canUndo; i++) {
      rev().undo();
      await settle();
      out[`rotation/rehydrated-undo-${i}`] = normalizeIds(canon(revivedView()));
    }
    while (rev().canRedo) { rev().redo(); await settle(); }
    out['rotation/rehydrated-redo-all'] = normalizeIds(canon(revivedView()));

    // A persisted store from before rows carried ids (older saves), and one with a stale shape.
    localStorage.setItem('wuwa_calc_rotation_cache', JSON.stringify({ state: { rows: [{ unit: 'Lumi', action: lumiMoves[0], timing: 'Auto' }, { unit: '', action: '', timing: 'Auto' }], startEnergy: false }, version: 0 }));
    const nodeAgain = await graph.getModuleByUrl(rotationUrl);
    if (nodeAgain) graph.invalidateModule(nodeAgain);
    const legacy = await load(rotationUrl);
    out['rotation/rehydrated-legacy-no-ids'] = normalizeIds(canon({ rows: legacy.useRotationStore.getState().rows.map(lightRow), startEnergy: legacy.useRotationStore.getState().startEnergy, canUndo: legacy.useRotationStore.getState().canUndo }));

    // ============================================================================================
    // Builder store
    // ============================================================================================
    await builder_('start', () => null);
    await builder_('open-char', () => builder().setActiveChar('Lumi', 'Characters', 5));
    const statKey = Object.keys(builder().baseStats).find(k => typeof builder().baseStats[k] === 'number');
    await builder_('baseStat', () => builder().setBaseStat(statKey, (builder().baseStats[statKey] || 0) + 7));
    await builder_('allBaseStats', () => builder().setAllBaseStats({ ...builder().baseStats, [statKey]: (builder().baseStats[statKey] || 0) + 11 }));
    const lumiKeys = Object.keys(builder().mechanics);
    const firstKey = lumiKeys[0];
    const secondKey = lumiKeys[1];
    const thirdKey = lumiKeys[2];
    const clone = o => JSON.parse(JSON.stringify(o));
    await builder_('node-edit', () => builder().setMechanicNode(firstKey, { ...clone(builder().mechanics[firstKey]), label: 'edited label' }));
    await builder_('node-edit-back-to-pristine', () => builder().setMechanicNode(firstKey, clone(DataLoader.pristineMechanics[firstKey])));
    await builder_('node-new', () => builder().setMechanicNode('Lumi_Brand New Move', { ...clone(builder().mechanics[secondKey]), name: 'Brand New Move' }));
    await builder_('node-new-insertAfter', () => builder().setMechanicNode('Lumi_Placed Move', { ...clone(builder().mechanics[secondKey]), name: 'Placed Move' }, secondKey));
    await builder_('node-update-existing-insertAfter', () => builder().setMechanicNode('Lumi_Placed Move', { ...clone(builder().mechanics['Lumi_Placed Move']), label: 'again' }, firstKey));
    await builder_('panel-open', () => builder().setOpenPanel('Lumi_Placed Move', 'effects'));
    await builder_('node-rename', () => builder().renameMechanicNode('Lumi_Placed Move', 'Lumi_Renamed Move', { ...clone(builder().mechanics['Lumi_Placed Move']), name: 'Renamed Move' }));
    await builder_('node-rename-same-id', () => builder().renameMechanicNode('Lumi_Renamed Move', 'Lumi_Renamed Move', { ...clone(builder().mechanics['Lumi_Renamed Move']), label: 'same id' }));
    await builder_('node-rename-pristine', () => builder().renameMechanicNode(secondKey, 'Lumi_Second Renamed', { ...clone(builder().mechanics[secondKey]), name: 'Second Renamed' }));
    await builder_('node-rename-chain', () => builder().renameMechanicNode('Lumi_Second Renamed', 'Lumi_Second Renamed Twice', { ...clone(builder().mechanics['Lumi_Second Renamed']), name: 'Second Renamed Twice' }));
    await builder_('node-rename-back-to-origin', () => builder().renameMechanicNode('Lumi_Second Renamed Twice', secondKey, clone(DataLoader.pristineMechanics[secondKey])));
    await builder_('node-revert-edited', () => { builder().setMechanicNode(thirdKey, { ...clone(builder().mechanics[thirdKey]), label: 'to revert' }); return builder().revertMechanicNode(thirdKey); });
    await builder_('node-revert-renamed', () => { builder().renameMechanicNode(thirdKey, 'Lumi_Third Renamed', { ...clone(builder().mechanics[thirdKey]), name: 'Third Renamed' }); return builder().revertMechanicNode('Lumi_Third Renamed'); });
    await builder_('node-revert-renamed-blocked', () => {
      builder().renameMechanicNode(thirdKey, 'Lumi_Third Renamed', { ...clone(builder().mechanics[thirdKey]), name: 'Third Renamed' });
      builder().setMechanicNode(thirdKey, { ...clone(DataLoader.pristineMechanics[thirdKey]), label: 'squatter' });
      return builder().revertMechanicNode('Lumi_Third Renamed');
    });
    await builder_('node-remove', () => builder().removeMechanicNode(firstKey));
    await builder_('node-remove-new', () => builder().removeMechanicNode('Lumi_Brand New Move'));
    await builder_('hasChanges', () => ({ Lumi: builder().hasChanges('Lumi'), Sanhua: builder().hasChanges('Sanhua'), prefixCollision: builder().hasChanges('Lum') }));
    await builder_('teamOverrides', () => builder().getTeamOverrides(['Lumi', 'Sanhua']));
    await builder_('teamOverrides-other', () => builder().getTeamOverrides(['Sanhua']));
    await builder_('open-second-char', () => builder().setActiveChar('Sanhua', 'Characters', 5));
    await builder_('second-char-edit', () => { const k = Object.keys(builder().mechanics)[0]; return builder().setMechanicNode(k, { ...clone(builder().mechanics[k]), label: 'sanhua edit' }); });
    await builder_('open-weapon', () => builder().setActiveChar('Radiance Cleaver', 'Weapons', 5));
    const weaponStat = Object.keys(builder().baseStats).find(k => typeof builder().baseStats[k] === 'number');
    await builder_('weapon-baseStat', () => builder().setBaseStat(weaponStat, (builder().baseStats[weaponStat] || 0) + 3));
    await builder_('open-none', () => builder().setActiveChar(null));
    await builder_('baseStat-without-active', () => builder().setBaseStat('anything', 1));
    await builder_('reopen-replays-edits', () => builder().setActiveChar('Lumi', 'Characters', 5));
    out['builder/persisted'] = normalizeIds(canon(JSON.parse(localStorage.getItem('wuwa_builder_cache') || 'null')));
    await builder_('discard-sanhua', () => builder().discardChanges('Sanhua'));
    await builder_('discard-lumi', () => builder().discardChanges('Lumi'));
    await builder_('open-weapon-again', () => builder().setActiveChar('Radiance Cleaver', 'Weapons', 5));
    await builder_('discard-weapon', async () => { builder().discardChanges('Radiance Cleaver'); await tick(); await tick(); });
    await builder_('edit-then-resetCache', async () => {
      await builder().setActiveChar('Lumi', 'Characters', 5);
      builder().setMechanicNode(Object.keys(builder().mechanics)[0], { ...clone(builder().mechanics[Object.keys(builder().mechanics)[0]]), label: 'lost on reset' });
      await builder().resetCache();
    });
    await builder_('mechFolderFor', () => ['Weapons', 'Echo Sets', 'sets', 'Echoes', 'System', 'Characters', 'whatever'].map(f => builderModule.mechFolderFor(f)));
    out['builder/nodeChangeKind'] = normalizeIds(canon(['Lumi_x', firstKey].map(id => builderModule.nodeChangeKind(id, id === 'Lumi_x' ? { a: 1 } : DataLoader.mechanicsDB[id], {}))));

    // TeamUtils / MechanicKey-style prefix rules that the stores lean on.
    out['builder/prefix-rules'] = normalizeIds(canon({
      hasChangesLum: builder().hasChanges('Lum'),
      teamOverridesPrefix: builder().getTeamOverrides(['Lum'])
    }));

    return out;
  } finally {
    globalThis.crypto.randomUUID = realRandomUUID;
    Math.random = realRandom;
    Object.assign(console, original);
  }
}
