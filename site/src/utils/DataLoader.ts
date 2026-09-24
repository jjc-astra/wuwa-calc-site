import { CommonUtils, sha256Hex } from './Common';
import { WIP_ENABLED, isWipUrl, wipToRealUrl, dataRelPath, realDataUrl, wipDataUrl } from './dataSource';
import { MechanicKey, SYSTEM_NAMESPACE } from './MechanicKey';
import { getTeamEntityRefs } from './TeamUtils';
import type { CharacterData, WeaponData, MechanicNode, TeamSlot, HoldConfig } from '../types/index';
import type { RotationFile, ResultsFile, RankingIndexEntry, CalcInput } from '../types/results';
import { defaultEnemyStats } from '../data/db';

// Gates content with no real mechanics yet: disabled in the Rotation Calculator, still
// selectable in the Builder. Toggle during content authoring.
export const DISABLE_UNIMPLEMENTED_CONTENT = true;

export type ImplementedContentKind = 'character' | 'weapon' | 'set' | 'echo';
const MECHANIC_FOLDER_BY_KIND: Record<ImplementedContentKind, string> = {
  character: 'characters', weapon: 'weapons', set: 'sets', echo: 'echoes'
};

// A ranked rotation ready to run: the rotation file's rotation and settings, and the team and
// target its results were calculated with.
export type RankedRun = CalcInput;

export const RANKINGS_DIR = 'character_results';

export class DataLoaderClass {
  cache = { mechanics: new Set<string>() };
  // Content-hash manifest (public/data/manifest.json). Detects changed data files without re-downloading. See dataFreshness.ts.
  manifest: Record<string, string> = {};
  // Hash recorded at last fetch -- vs a fresh manifest, tells "changed" from "never loaded"/"unchanged".
  loadedHashes: Record<string, string> = {};
  // Local dev mechanics/ mirrors lacking manifest baselines; dataFreshness skips them to avoid false-positive verification.
  wipSourced = new Set<string>();
  private manifestFetchedAt = 0;
  // Cooldown map for failed entity fetches to prevent spamming network retries and console errors on every recalculation.
  private missingUntil = new Map<string, number>();
  private static readonly MISSING_RETRY_MS = 30_000;
  // Resolves when initial DBs populate, guarding store rehydration callbacks against reading empty DataLoaders on module evaluation.
  private resolveReady!: () => void;
  ready: Promise<void> = new Promise(resolve => { this.resolveReady = resolve; });
  characterDB: Record<string, CharacterData> = {};
  weaponDB: Record<string, WeaponData> = {};
  buildDB: Record<string, any> = {};
  mechanicsDB: Record<string, MechanicNode> = {};
  // mechanicsDB, mechanicsIndex and pristineMechanics move together -- write them only through
  // registerFetchedNode / registerMechanicNode / unregisterMechanicNode / clearMechanicCache.
  // pristineMechanics is each node as last fetched, the baseline the Builder diffs edits against
  // (mechanicsDB holds live/edited nodes once the edit log is replayed onto it).
  pristineMechanics: Record<string, MechanicNode> = {};
  mechanicsIndex: Record<string, string[]> = {};
  charList: string[] = [];
  // Rankings: the index (every ranked row), and full runs fetched per entry only when needed.
  rankingIndex: RankingIndexEntry[] | null = null;
  rankedRuns: Record<string, Promise<RankedRun>> = {};
  weaponsByType: Record<string, string[]> = {
    Broadblade: [], Sword: [], Rectifier: [], Gauntlets: [], Pistols: []
  };

  sonataSets: string[] = [];
  setEchoMapping: Record<string, string[]> = {};
  allMainEchoes: string[] = [];
  // Sets whose bonus activates at 3 pieces (paired with a 2pc subSet) instead of the standard
  // 2pc+5pc shape -- see resolveSetPieceCounts.
  threePcSets: string[] = [];
  // Sets whose bonus activates from the main-slot echo alone -- see resolveSetPieceCounts.
  onePcSets: string[] = [];

  // A file the manifest knows is requested by its content hash, so the browser can cache it until
  // it changes. Anything else (the manifest itself, WIP files) always refetches.
  private versionedUrl(path: string): string {
    const hash = isWipUrl(path) ? undefined : this.manifest[dataRelPath(path)];
    return hash ? `${path}?v=${hash}` : `${path}?t=${Date.now()}`;
  }

  private async _fetchJSON<T>(path: string, silent = false): Promise<T | null> {
    try {
      const text = await this._fetchText(path, true);
      if (text === null) throw new Error('Missing, or not JSON.');
      return JSON.parse(text) as T;
    } catch (e) {
      if (!silent) console.error(`[DataLoader] Failed to load JSON from ${path}.`, e);
      return null;
    }
  }

  // A data file's raw text, or null if it's missing.
  private async _fetchText(path: string, throwOnError = false): Promise<string | null> {
    try {
      const res = await fetch(this.versionedUrl(path));
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const text = await res.text();
      // Vite's dev server serves index.html (200 OK, not a 404) for ANY path under public/ that
      // doesn't exist -- its SPA history fallback. A missing WIP file hits this constantly, so
      // check for it explicitly (JSON never starts with '<') instead of letting JSON.parse's
      // syntax error do the job by accident.
      if (/^\s*</.test(text)) throw new Error('Received HTML, not JSON (path does not exist).');
      return text;
    } catch (e) {
      if (throwOnError) throw e;
      return null;
    }
  }

  // In a dev build `path` (from getData) may point at the local WIP mirror; one this entity has
  // no override for doesn't resolve there (see _fetchJSON), silently, and falls back to the real
  // data repo. In a prod build `path` is already the real repo and no WIP branch ever runs.
  //
  // `manifestKey` is the file's path in the manifest. The manifest lists every file the data repo
  // has, so once it's loaded a file it lacks would only 404 -- the request is skipped instead.
  async loadJSON<T>(path: string, opts: { skipHashTracking?: boolean; manifestKey?: string } = {}): Promise<T | null> {
    const isWipAttempt = isWipUrl(path);
    const absentFromRepo = !!opts.manifestKey && Object.keys(this.manifest).length > 0 && !this.manifest[opts.manifestKey];
    if (absentFromRepo && !isWipAttempt) return null;
    let usedPath = path;
    let data = await this._fetchJSON<T>(path, isWipAttempt);
    const servedFromWip = isWipAttempt && data !== null;
    if (data === null && isWipAttempt && !absentFromRepo) {
      usedPath = wipToRealUrl(path);
      data = await this._fetchJSON<T>(usedPath);
    }
    // Records the manifest hash as loaded content, or flags dev WIP paths lacking a manifest baseline.
    if (data !== null && !opts.skipHashTracking) {
      const relPath = dataRelPath(usedPath);
      if (servedFromWip) {
        this.wipSourced.add(relPath);
      } else {
        this.wipSourced.delete(relPath);
        if (this.manifest[relPath]) this.loadedHashes[relPath] = this.manifest[relPath];
      }
    }
    return data;
  }

  // For a combined multi-entity DB file (db_characters.json etc.) only -- a WIP copy is
  // shallow-merged on top of the real file's entries instead of swapping it wholesale, since
  // the WIP file only needs to hold the unit(s) under test, not a full duplicate of every
  // shipped character/weapon. Prod builds skip the WIP fetch entirely.
  async loadMergedDB<T extends Record<string, any>>(relPath: string): Promise<T> {
    const real = (await this.loadJSON<T>(realDataUrl(relPath))) || ({} as T);
    if (!WIP_ENABLED) return real;
    const wip = await this._fetchJSON<T>(wipDataUrl(relPath), true);
    return wip ? ({ ...real, ...wip } as T) : real;
  }

  // On-disk filename for a mechanic entity. The rest of the app calls this entity 'System', but
  // the data repo's real file is lowercase system.json -- this is the one place that translates.
  private mechanicFileName(itemName: string): string {
    return itemName === 'System' ? 'system' : itemName.replace(/\s+/g, '_');
  }

  // Same relPath convention loadMechanic uses internally, exposed for dataFreshness.ts.
  mechanicPath(folder: string, itemName: string): string {
    return `mechanics/${folder}/${this.mechanicFileName(itemName)}.json`;
  }

  // cache.mechanics key for (folder, itemName) -- combines folder with mechanicFileName's
  // System->'system' translation, so every caller agrees on the same key regardless of casing.
  mechanicCacheKey(folder: string, itemName: string): string {
    return `${folder}/${this.mechanicFileName(itemName)}`;
  }

  // Derived from the manifest (populated first -- see App.tsx's initDatabases gate), not a
  // hand-maintained list: "implemented" = a mechanics JSON file exists on disk for `name`.
  isContentImplemented(kind: ImplementedContentKind, name: string): boolean {
    if (!DISABLE_UNIMPLEMENTED_CONTENT) return true;
    return !!this.manifest[this.mechanicPath(MECHANIC_FOLDER_BY_KIND[kind], name)];
  }

  // Throttled (5s) so near-simultaneous callers collapse into one request.
  // `force` bypasses the throttle for initDatabases's startup call.
  async refreshManifest(force = false): Promise<Record<string, string>> {
    const now = Date.now();
    if (!force && this.manifestFetchedAt && now - this.manifestFetchedAt < 5000) return this.manifest;
    this.manifestFetchedAt = now;
    const fresh = await this.loadJSON<Record<string, string>>(CommonUtils.getData('manifest.json'), { skipHashTracking: true });
    if (fresh) {
      this.manifest = fresh;
      this.backfillLoadedHashes(fresh);
    }
    return this.manifest;
  }

  // Identifies a data file's current content, for caches of results calculated from it: the
  // manifest's hash (call refreshManifest first), plus -- in dev -- a hash of the WIP mirror's
  // copy, which either replaces the real file or merges over it and has no manifest entry.
  async contentVersion(relPath: string): Promise<string> {
    const real = this.manifest[relPath] ?? 'none';
    if (!WIP_ENABLED) return real;
    const wip = await this._fetchText(wipDataUrl(relPath));
    return wip === null ? real : `${real}+wip:${(await sha256Hex(wip)).slice(0, 16)}`;
  }

  // Sets a loadedHashes baseline for anything cached but not yet hashed (e.g. useRosterStore
  // rehydrating before any manifest fetch). Runs on every fetch so unhashed paths get another chance.
  private backfillLoadedHashes(manifest: Record<string, string>): void {
    for (const cacheKey of this.cache.mechanics) {
      const relPath = `mechanics/${cacheKey}.json`;
      if (this.wipSourced.has(relPath)) continue;
      if (!this.loadedHashes[relPath] && manifest[relPath]) {
        this.loadedHashes[relPath] = manifest[relPath];
      }
    }
  }

  async initDatabases(): Promise<void> {
    await this.refreshManifest(true);
    this.characterDB = await this.loadMergedDB<Record<string, CharacterData>>('db_characters.json');
    this.weaponDB = await this.loadMergedDB<Record<string, WeaponData>>('db_weapons.json');
    this.buildDB = await this.loadMergedDB<Record<string, any>>('db_builds.json');

    this.charList = Object.keys(this.characterDB);
    this.weaponsByType = { Broadblade: [], Sword: [], Rectifier: [], Gauntlets: [], Pistols: [] };

    Object.keys(this.weaponDB).forEach(weaponName => {
      const type = this.weaponDB[weaponName].weaponType;
      if (this.weaponsByType[type]) this.weaponsByType[type].push(weaponName);
    });

    // Note: loadMergedDB only merges top-level keys, so a WIP db_echoes.json's own
    // SET_ECHO_MAPPING replaces the real one wholesale rather than merging per-set -- fine for
    // adding a standalone new sonata set (the common case), just include the whole mapping.
    const echoData = await this.loadMergedDB<any>('db_echoes.json');
    this.setEchoMapping = echoData.SET_ECHO_MAPPING || {};
    this.sonataSets = Object.keys(this.setEchoMapping);
    this.allMainEchoes = Array.from(new Set(Object.values(this.setEchoMapping).flat()));
    this.threePcSets = echoData.THREE_PC_SETS || [];
    this.onePcSets = echoData.ONE_PC_SETS || [];

    await this.loadMechanic('system', SYSTEM_NAMESPACE);
    this.resolveReady();
  }

  // Loads every mechanic a team needs. Shared by the roster store and the calc worker's own
  // separate DataLoader instance.
  //
  // System (Dodge, Jump, Tune Break...) applies regardless of team, so it's always
  // loaded here -- calc.worker.ts's builder-override path clears it first and relies on this to restore it.
  async loadTeamMechanics(team: TeamSlot[]): Promise<void> {
    for (const ref of getTeamEntityRefs(team, { includeSystem: true, dedupe: true })) {
      await this.loadMechanic(ref.folder, ref.name);
    }
  }

  // A main set contributes all 5 echo pieces unless it's a 3pc set (paired with a 2pc subSet)
  // or a 1pc set (worn as the main-slot echo alone, leaving 4 pieces split across
  // subSet2a/subSet2b). Used to gate which of a set's mechanic nodes (tagged "N-pc Set Effect")
  // actually apply -- see TimelineEngine._setupEventBoard's registerAll.
  resolveSetPieceCounts(slot: { mainSet: string; subSet: string; subSet2a: string; subSet2b: string }): {
    mainSet: number; subSet: number; subSet2a: number; subSet2b: number;
  } {
    const isOnePcSet = this.onePcSets.includes(slot.mainSet);
    const isThreePcSet = this.threePcSets.includes(slot.mainSet);

    if (isOnePcSet) {
      // A 3pc pick in either extra slot is evaluated first -- it's the more restrictive shape,
      // leaving only 1 of the 4 remaining pieces for the other slot, never enough for a 2pc (or
      // a second 3pc). No UI cross-validation stops a "silly" combo (e.g. both slots holding
      // 3pc sets) -- this just resolves it deterministically, second slot loses.
      const aIsThreePc = !!slot.subSet2a && this.threePcSets.includes(slot.subSet2a);
      const bIsThreePc = !!slot.subSet2b && this.threePcSets.includes(slot.subSet2b);
      let subSet2a = 0, subSet2b = 0;
      if (aIsThreePc) subSet2a = 3;
      else if (bIsThreePc) subSet2b = 3;
      else {
        if (slot.subSet2a) subSet2a = 2;
        if (slot.subSet2b) subSet2b = 2;
      }
      return { mainSet: 1, subSet: 0, subSet2a, subSet2b };
    }
    if (isThreePcSet) return { mainSet: 3, subSet: slot.subSet ? 2 : 0, subSet2a: 0, subSet2b: 0 };
    return { mainSet: slot.mainSet ? 5 : 0, subSet: 0, subSet2a: 0, subSet2b: 0 };
  }

  // The main echoes a slot's set choice allows: the main set's echoes, plus a 3pc set's paired
  // subSet's. Empty until there's a main set; a set with no mapping allows any main echo.
  allowedMainEchoes(slot: { mainSet: string; subSet: string }): string[] {
    if (!slot.mainSet) return [];
    const allowed: string[] = [...(this.setEchoMapping[slot.mainSet] || [])];
    if (this.threePcSets.includes(slot.mainSet) && slot.subSet) allowed.push(...(this.setEchoMapping[slot.subSet] || []));
    const unique = Array.from(new Set(allowed));
    return unique.length === 0 ? this.allMainEchoes : unique;
  }

  async loadMechanic(folder: string, itemName: string): Promise<void> {
    if (!itemName) return;
    const cacheKey = this.mechanicCacheKey(folder, itemName);
    if (this.cache.mechanics.has(cacheKey)) return;
    const cooldownUntil = this.missingUntil.get(cacheKey);
    if (cooldownUntil && Date.now() < cooldownUntil) return;
    const relPath = this.mechanicPath(folder, itemName);
    const data = await this.loadJSON<Record<string, MechanicNode>>(CommonUtils.getData(relPath), { manifestKey: relPath });
    if (data) {
      for (const [key, mechData] of Object.entries(data)) {
        this.registerFetchedNode(key, mechData);
      }
      this.cache.mechanics.add(cacheKey);
      this.missingUntil.delete(cacheKey);
    } else {
      this.missingUntil.set(cacheKey, Date.now() + DataLoaderClass.MISSING_RETRY_MS);
    }
  }

  // mechanicsDB alone isn't enough to make a node reachable -- mechanicsIndex (keyed by
  // character/weapon/'System', per this same key's prefix) is what the rotation-row action
  // dropdown and the worker's per-unit passive registration actually iterate. The Builder's
  // own edit paths (setActiveChar's replay, setMechanicNode, renameMechanicNode) and the calc
  // worker's applyBuilderOverrides all need both kept in sync -- use these instead of writing
  // mechanicsDB directly.
  registerMechanicNode(key: string, node: MechanicNode): void {
    this.mechanicsDB[key] = node;
    const indexKey = MechanicKey.parse(key).namespace;
    if (!this.mechanicsIndex[indexKey]) this.mechanicsIndex[indexKey] = [];
    if (!this.mechanicsIndex[indexKey].includes(key)) this.mechanicsIndex[indexKey].push(key);
  }

  // A node as fetched: registers the live copy plus an untouched baseline for the Builder's diff.
  // Cloned first because live nodes get mutated later (e.g. _compiledRule attached).
  registerFetchedNode(key: string, node: MechanicNode): void {
    this.pristineMechanics[key] = JSON.parse(JSON.stringify(node));
    this.registerMechanicNode(key, node);
  }

  unregisterMechanicNode(key: string): void {
    delete this.mechanicsDB[key];
    const indexKey = MechanicKey.parse(key).namespace;
    if (this.mechanicsIndex[indexKey]) {
      this.mechanicsIndex[indexKey] = this.mechanicsIndex[indexKey].filter(k => k !== key);
    }
  }

  // An entity's base stats, live -- a character's or a weapon's, whichever owns the name.
  baseStatsFor(name: string): (CharacterData | WeaponData) | undefined {
    return this.characterDB[name] || this.weaponDB[name];
  }

  // Locates a character's Hold Release mechanic (optionally input-scoped) to keep TimelineEngine and Gauge lookup logic unified.
  findHoldReleaseConfig(charName: string, matchInput?: string): HoldConfig | null {
    const hasRepeatForInput = Object.keys(this.mechanicsDB).some(k => {
      const m = this.mechanicsDB[k];
      if (!MechanicKey.belongsTo(k, charName) || m.inputType !== 'Repeat') return false;
      return matchInput === undefined || m.input === matchInput;
    });
    if (hasRepeatForInput) return null;

    const releaseKey = Object.keys(this.mechanicsDB).find(k => {
      const m = this.mechanicsDB[k];
      if (!MechanicKey.belongsTo(k, charName) || m.inputType !== 'Release' || !m.holdConfig) return false;
      if (matchInput !== undefined && m.input !== matchInput) return false;
      return true;
    });
    return releaseKey ? (this.mechanicsDB[releaseKey].holdConfig as HoldConfig) : null;
  }

  // Every ranked row, from the generated index.json (one small file instead of one per entry).
  async loadRankingIndex(): Promise<RankingIndexEntry[]> {
    if (!this.rankingIndex) {
      this.rankingIndex = (await this.loadJSON<RankingIndexEntry[]>(CommonUtils.getData(`${RANKINGS_DIR}/index.json`))) || [];
    }
    return this.rankingIndex;
  }

  // An entry's results file (for its calculated team) and rotation file (for the rotation itself).
  loadRankedRun(entry: { id: string; rotationFile: string }): Promise<RankedRun> {
    this.rankedRuns[entry.id] ??= (async () => {
      const [results, rotation] = await Promise.all([
        this.loadJSON<ResultsFile>(CommonUtils.getData(`${RANKINGS_DIR}/results/${entry.id}`)),
        this.loadJSON<RotationFile>(CommonUtils.getData(`${RANKINGS_DIR}/rotations/${entry.rotationFile}`))
      ]);
      if (!results || !rotation) {
        delete this.rankedRuns[entry.id];
        throw new Error('This rotation is no longer available.');
      }
      if (results.hash !== rotation.hash) {
        console.warn(`[DataLoader] "${entry.id}" was calculated from a different version of "${entry.rotationFile}".`);
      }
      return { rotation: rotation.rotation, settings: rotation.settings || {}, team: results.team, enemy: results.enemy ?? defaultEnemyStats() };
    })();
    return this.rankedRuns[entry.id];
  }

  clearMechanicCache(folder: string, itemName: string): void {
    if (!itemName) return;
    const cacheKey = this.mechanicCacheKey(folder, itemName);

    this.cache.mechanics.delete(cacheKey);
    this.missingUntil.delete(cacheKey);
    this.wipSourced.delete(this.mechanicPath(folder, itemName));

    for (const map of [this.mechanicsDB, this.pristineMechanics]) {
      Object.keys(map).forEach(key => {
        if (MechanicKey.belongsTo(key, itemName)) delete map[key];
      });
    }
    delete this.mechanicsIndex[MechanicKey.toNamespace(itemName)];
  }
}

export const DataLoader = new DataLoaderClass();