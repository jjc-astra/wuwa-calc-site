import { CommonUtils } from './Common';
import { WIP_ENABLED, WIP_FILES_URL, isWipUrl, wipToRealUrl, dataRelPath, realDataUrl, wipDataUrl } from './dataSource';
import { MechanicKey, SYSTEM_NAMESPACE } from './MechanicKey';
import { getTeamEntityRefs } from './TeamUtils';
import type { CharacterData, WeaponData, MechanicNode, TeamSlot, HoldConfig } from '../types/index';
import type { RotationFile, ResultsFile, RankingIndexEntry, CalcInput } from '../types/results';
import { defaultEnemyStats } from '../data/db';

// Disables unimplemented content in the Calculator (still selectable in the Builder).
const DISABLE_UNIMPLEMENTED_CONTENT = true;

export type ImplementedContentKind = 'character' | 'weapon' | 'set' | 'echo';
const MECHANIC_FOLDER_BY_KIND: Record<ImplementedContentKind, string> = {
  character: 'characters', weapon: 'weapons', set: 'sets', echo: 'echoes'
};

// A ranked rotation with the team and target it was calculated with.
export type RankedRun = CalcInput;

export const RANKINGS_DIR = 'character_results';

interface SeededFile {
  hash: string;
  text: string;
}

/** Repo and (dev) WIP content-hash manifests. */
export interface Manifests {
  manifest: Record<string, string>;
  wipManifest: Record<string, string> | null;
}

/** Seed for a calc worker's DataLoader, in place of the network. */
export interface DataSeed extends Manifests {
  files: Map<string, SeededFile>;
}

// Loads and caches game data and mechanics. One instance per thread.
export class DataLoaderClass {
  cache = { mechanics: new Set<string>() };
  // Content-hash manifest; detects changed data files.
  manifest: Record<string, string> = {};
  // Dev only: WIP mirror manifest. Null until fetched (every WIP URL is tried).
  wipManifest: Record<string, string> | null = null;
  // Hash at last fetch, compared against currentHash.
  loadedHashes: Record<string, string> = {};
  private manifestFetchedAt = 0;
  // Shared in-flight manifest fetch.
  private manifestRequest: Promise<Record<string, string>> | null = null;
  // Shared in-flight mechanic fetches.
  private mechanicRequests = new Map<string, Promise<void>>();
  // Base stats snapshotted before the first Builder edit.
  private pristineBaseStats = new Map<string, CharacterData | WeaponData>();
  // Page only: keeps fetched file text to seed calc workers.
  private keepsFileText = typeof window !== 'undefined';
  private fileText = new Map<string, SeededFile>();
  // Worker only: seeded file text, used once per path if the hash matches.
  private seededText = new Map<string, SeededFile>();
  // Retry cooldown for failed entity fetches.
  private missingUntil = new Map<string, number>();
  private static readonly MISSING_RETRY_MS = 30_000;
  // Resolves once the initial DBs are loaded.
  private resolveReady!: () => void;
  ready: Promise<void> = new Promise(resolve => { this.resolveReady = resolve; });
  characterDB: Record<string, CharacterData> = {};
  weaponDB: Record<string, WeaponData> = {};
  buildDB: Record<string, any> = {};
  mechanicsDB: Record<string, MechanicNode> = {};
  // mechanicsDB, mechanicsIndex, pristineMechanics: write only via the register/unregister/clear helpers.
  // pristineMechanics: nodes as fetched, the Builder's diff baseline.
  pristineMechanics: Record<string, MechanicNode> = {};
  mechanicsIndex: Record<string, string[]> = {};
  charList: string[] = [];
  // Rankings index, plus results fetched per entry on demand.
  rankingIndex: RankingIndexEntry[] | null = null;
  rankedRuns: Record<string, Promise<RankedRun>> = {};
  rankedResults: Record<string, Promise<ResultsFile>> = {};
  weaponsByType: Record<string, string[]> = {};

  sonataSets: string[] = [];
  setEchoMapping: Record<string, string[]> = {};
  allMainEchoes: string[] = [];
  // 3pc sets (paired with a 2pc subSet).
  threePcSets: string[] = [];
  // 1pc sets (main-slot echo alone).
  onePcSets: string[] = [];

  // Adds the content hash for browser caching; unknown files always refetch.
  private versionedUrl(path: string): string {
    const hash = isWipUrl(path) ? undefined : this.manifest[dataRelPath(path)];
    return hash ? `${path}?v=${hash}` : `${path}?t=${Date.now()}`;
  }

  // Expected hash for `path` (WIP or repo).
  private fileHash(path: string): string | undefined {
    const relPath = dataRelPath(path);
    return isWipUrl(path) ? this.wipHash(relPath) : this.manifest[relPath];
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

  // Raw file text, or null if missing.
  private async _fetchText(path: string, throwOnError = false): Promise<string | null> {
    const hash = this.fileHash(path);
    const seeded = this.seededText.get(path);
    if (seeded) {
      // Single use; later reloads fetch fresh.
      this.seededText.delete(path);
      if (seeded.hash === hash) return seeded.text;
    }
    try {
      const res = await fetch(this.versionedUrl(path));
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const text = await res.text();
      // Vite serves index.html (200) for missing files.
      if (/^\s*</.test(text)) throw new Error('Received HTML, not JSON (path does not exist).');
      if (this.keepsFileText && hash && /^(db_|mechanics\/)/.test(dataRelPath(path))) this.fileText.set(path, { hash, text });
      return text;
    } catch (e) {
      if (throwOnError) throw e;
      return null;
    }
  }

  // Dev: tries the WIP mirror first, falling back to the data repo.
  // `manifestKey`: skips the request when the loaded manifest lacks the file.
  async loadJSON<T>(path: string, opts: { skipHashTracking?: boolean; manifestKey?: string } = {}): Promise<T | null> {
    if (isWipUrl(path) && !this.mayBeInWip(dataRelPath(path))) path = wipToRealUrl(path);
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
    if (data !== null && !opts.skipHashTracking) {
      const relPath = dataRelPath(usedPath);
      const hash = servedFromWip ? this.wipHash(relPath) : this.manifest[relPath];
      if (hash) this.loadedHashes[relPath] = hash;
      else delete this.loadedHashes[relPath];
    }
    return data;
  }

  // Combined DB files: a WIP copy is shallow-merged over the real one (dev only).
  async loadMergedDB<T extends Record<string, any>>(relPath: string): Promise<T> {
    const real = (await this.loadJSON<T>(realDataUrl(relPath))) || ({} as T);
    if (!WIP_ENABLED || !this.mayBeInWip(relPath)) return real;
    const wip = await this._fetchJSON<T>(wipDataUrl(relPath), true);
    return wip ? ({ ...real, ...wip } as T) : real;
  }

  // On-disk filename ('System' -> system.json).
  private mechanicFileName(itemName: string): string {
    return itemName === SYSTEM_NAMESPACE ? 'system' : itemName.replace(/\s+/g, '_');
  }

  mechanicPath(folder: string, itemName: string): string {
    return `mechanics/${folder}/${this.mechanicFileName(itemName)}.json`;
  }

  // cache.mechanics key for (folder, itemName).
  mechanicCacheKey(folder: string, itemName: string): string {
    return `${folder}/${this.mechanicFileName(itemName)}`;
  }

  // Implemented = a mechanics file exists in the manifest (or WIP mirror).
  isContentImplemented(kind: ImplementedContentKind, name: string): boolean {
    if (!DISABLE_UNIMPLEMENTED_CONTENT) return true;
    const path = this.mechanicPath(MECHANIC_FOLDER_BY_KIND[kind], name);
    return !!this.currentHash(path);
  }

  private wipHash(relPath: string): string | undefined {
    const hash = WIP_ENABLED ? this.wipManifest?.[relPath] : undefined;
    return hash && `wip:${hash}`;
  }

  private mayBeInWip(relPath: string): boolean {
    return !this.wipManifest || !!this.wipManifest[relPath];
  }

  // Hash a fresh load would get (WIP first, then repo).
  currentHash(relPath: string): string | undefined {
    return this.wipHash(relPath) ?? this.manifest[relPath];
  }

  // Throttled to 5s; `force` bypasses the throttle.
  refreshManifest(force = false): Promise<Record<string, string>> {
    if (this.manifestRequest) return this.manifestRequest;
    const now = Date.now();
    if (!force && this.manifestFetchedAt && now - this.manifestFetchedAt < 5000) return Promise.resolve(this.manifest);
    this.manifestFetchedAt = now;
    this.manifestRequest = (async () => {
      const [fresh, wip] = await Promise.all([
        this.loadJSON<Record<string, string>>(realDataUrl('manifest.json'), { skipHashTracking: true }),
        WIP_ENABLED ? this._fetchJSON<Record<string, string>>(WIP_FILES_URL, true) : null
      ]);
      if (fresh) this.manifest = fresh;
      if (wip) this.wipManifest = wip;
      this.backfillLoadedHashes();
      return this.manifest;
    })().finally(() => { this.manifestRequest = null; });
    return this.manifestRequest;
  }

  // Content version key (repo + WIP hashes) for result caches.
  contentVersion(relPath: string): string {
    const real = this.manifest[relPath] ?? 'none';
    const wip = this.wipHash(relPath);
    return wip ? `${real}+${wip}` : real;
  }

  // Baselines loadedHashes for cached-but-unhashed paths.
  private backfillLoadedHashes(): void {
    for (const cacheKey of this.cache.mechanics) {
      const relPath = `mechanics/${cacheKey}.json`;
      const hash = this.currentHash(relPath);
      if (!this.loadedHashes[relPath] && hash) this.loadedHashes[relPath] = hash;
    }
  }

  /** Current manifests, for a calc worker to adopt. */
  currentManifests(): Manifests {
    return { manifest: this.manifest, wipManifest: this.wipManifest };
  }

  // Calc workers take manifests from the page.
  adoptManifests({ manifest, wipManifest }: Manifests): void {
    this.manifest = manifest;
    this.wipManifest = wipManifest;
    this.manifestFetchedAt = Date.now();
    this.backfillLoadedHashes();
  }

  /** True when an entity's cached mechanics no longer match the manifest. */
  mechanicChanged(folder: string, name: string): boolean {
    if (!this.cache.mechanics.has(this.mechanicCacheKey(folder, name))) return false;
    const relPath = this.mechanicPath(folder, name);
    const latestHash = this.currentHash(relPath);
    if (!latestHash) return false;
    const knownHash = this.loadedHashes[relPath];
    if (!knownHash) {
      this.loadedHashes[relPath] = latestHash;
      return false;
    }
    return knownHash !== latestHash;
  }

  /** Manifests and kept file text for seeding calc workers. Stops keeping text. */
  dataSeed(): DataSeed {
    this.keepsFileText = false;
    return { ...this.currentManifests(), files: this.fileText };
  }

  releaseFileText(): void {
    this.fileText = new Map();
  }

  /** Applies Builder base-stat edits, snapshotting the original first. */
  editBaseStats(name: string, stats: Record<string, unknown>): void {
    const target = this.baseStatsFor(name);
    if (!target) return;
    if (!this.pristineBaseStats.has(name)) this.pristineBaseStats.set(name, structuredClone(target));
    Object.assign(target, stats);
  }

  /** Undoes editBaseStats. */
  restoreBaseStats(name: string): void {
    const pristine = this.pristineBaseStats.get(name);
    const target = this.baseStatsFor(name);
    if (!pristine || !target) return;
    Object.keys(target).forEach(k => delete (target as any)[k]);
    Object.assign(target, pristine);
    this.pristineBaseStats.delete(name);
  }

  /** Undoes every Builder edit to an entity. */
  restorePristine(name: string): void {
    this.restoreBaseStats(name);
    Object.keys(this.mechanicsDB).forEach(key => { if (MechanicKey.belongsTo(key, name)) delete this.mechanicsDB[key]; });
    delete this.mechanicsIndex[MechanicKey.toNamespace(name)];
    Object.entries(this.pristineMechanics).forEach(([key, node]) => {
      if (MechanicKey.belongsTo(key, name)) this.registerMechanicNode(key, structuredClone(node));
    });
  }

  // `seed`: calc worker startup from the page's data.
  async initDatabases(seed?: DataSeed): Promise<void> {
    if (seed) {
      this.adoptManifests(seed);
      this.seededText = new Map(seed.files);
    } else {
      await this.refreshManifest(true);
    }
    this.pristineBaseStats.clear();
    this.characterDB = await this.loadMergedDB<Record<string, CharacterData>>('db_characters.json');
    this.weaponDB = await this.loadMergedDB<Record<string, WeaponData>>('db_weapons.json');
    this.buildDB = await this.loadMergedDB<Record<string, any>>('db_builds.json');

    this.charList = Object.keys(this.characterDB);
    this.weaponsByType = {};
    Object.entries(this.weaponDB).forEach(([weaponName, weapon]) => (this.weaponsByType[weapon.weaponType] ??= []).push(weaponName));

    // Top-level merge: a WIP SET_ECHO_MAPPING replaces the real one wholesale.
    const echoData = await this.loadMergedDB<any>('db_echoes.json');
    this.setEchoMapping = echoData.SET_ECHO_MAPPING || {};
    this.sonataSets = Object.keys(this.setEchoMapping);
    this.allMainEchoes = Array.from(new Set(Object.values(this.setEchoMapping).flat()));
    this.threePcSets = echoData.THREE_PC_SETS || [];
    this.onePcSets = echoData.ONE_PC_SETS || [];

    await this.loadMechanic('system', SYSTEM_NAMESPACE);
    this.resolveReady();
  }

  // Loads every mechanic a team needs, plus System.
  async loadTeamMechanics(team: TeamSlot[]): Promise<void> {
    await Promise.all(getTeamEntityRefs(team, { includeSystem: true, dedupe: true }).map(ref => this.loadMechanic(ref.folder, ref.name)));
  }

  // Piece count per set: main set is 5pc unless it's a 3pc or 1pc set.
  resolveSetPieceCounts(slot: { mainSet: string; subSet: string; subSet2a: string; subSet2b: string }): {
    mainSet: number; subSet: number; subSet2a: number; subSet2b: number;
  } {
    const isOnePcSet = this.onePcSets.includes(slot.mainSet);
    const isThreePcSet = this.threePcSets.includes(slot.mainSet);

    if (isOnePcSet) {
      // 3pc first; if both slots are 3pc, the second loses.
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

  // Main echoes allowed by a slot's sets. Unmapped sets allow any.
  allowedMainEchoes(slot: { mainSet: string; subSet: string }): string[] {
    if (!slot.mainSet) return [];
    const allowed: string[] = [...(this.setEchoMapping[slot.mainSet] || [])];
    if (this.threePcSets.includes(slot.mainSet) && slot.subSet) allowed.push(...(this.setEchoMapping[slot.subSet] || []));
    const unique = Array.from(new Set(allowed));
    return unique.length === 0 ? this.allMainEchoes : unique;
  }

  loadMechanic(folder: string, itemName: string): Promise<void> {
    if (!itemName) return Promise.resolve();
    const cacheKey = this.mechanicCacheKey(folder, itemName);
    if (this.cache.mechanics.has(cacheKey)) return Promise.resolve();
    const pending = this.mechanicRequests.get(cacheKey);
    if (pending) return pending;
    const cooldownUntil = this.missingUntil.get(cacheKey);
    if (cooldownUntil && Date.now() < cooldownUntil) return Promise.resolve();
    const relPath = this.mechanicPath(folder, itemName);
    const request = (async () => {
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
    })().finally(() => this.mechanicRequests.delete(cacheKey));
    this.mechanicRequests.set(cacheKey, request);
    return request;
  }

  // Keeps mechanicsDB and mechanicsIndex in sync; use instead of writing mechanicsDB directly.
  registerMechanicNode(key: string, node: MechanicNode): void {
    this.mechanicsDB[key] = node;
    const indexKey = MechanicKey.parse(key).namespace;
    if (!this.mechanicsIndex[indexKey]) this.mechanicsIndex[indexKey] = [];
    if (!this.mechanicsIndex[indexKey].includes(key)) this.mechanicsIndex[indexKey].push(key);
  }

  // Registers a live copy plus a pristine baseline for the Builder's diff.
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

  // Live base stats for a character or weapon.
  baseStatsFor(name: string): (CharacterData | WeaponData) | undefined {
    return this.characterDB[name] || this.weaponDB[name];
  }

  // Hold Release cursor config; null for Repeat-style holds.
  findHoldReleaseConfig(charName: string, matchInput?: string): HoldConfig | null {
    const moves = (this.mechanicsIndex[charName] || [])
      .map(key => this.mechanicsDB[key])
      .filter(m => m && (matchInput === undefined || m.input === matchInput));
    if (moves.some(m => m.inputType === 'Repeat')) return null;
    return moves.find(m => m.inputType === 'Release' && m.holdConfig)?.holdConfig ?? null;
  }

  // Every ranked row, from index.json.
  async loadRankingIndex(): Promise<RankingIndexEntry[]> {
    if (!this.rankingIndex) {
      this.rankingIndex = (await this.loadJSON<RankingIndexEntry[]>(CommonUtils.getData(`${RANKINGS_DIR}/index.json`))) || [];
    }
    return this.rankingIndex;
  }

  // An entry's full results file.
  loadRankedResults(entry: { id: string }): Promise<ResultsFile> {
    this.rankedResults[entry.id] ??= (async () => {
      const results = await this.loadJSON<ResultsFile>(CommonUtils.getData(`${RANKINGS_DIR}/results/${entry.id}`));
      if (!results) {
        delete this.rankedResults[entry.id];
        throw new Error('This rotation is no longer available.');
      }
      return results;
    })();
    return this.rankedResults[entry.id];
  }

  // An entry's results and rotation files.
  loadRankedRun(entry: { id: string; rotationFile: string }): Promise<RankedRun> {
    this.rankedRuns[entry.id] ??= (async () => {
      const [results, rotation] = await Promise.all([
        this.loadRankedResults(entry).catch(() => null),
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
    this.mechanicRequests.delete(cacheKey);

    for (const map of [this.mechanicsDB, this.pristineMechanics]) {
      Object.keys(map).forEach(key => {
        if (MechanicKey.belongsTo(key, itemName)) delete map[key];
      });
    }
    delete this.mechanicsIndex[MechanicKey.toNamespace(itemName)];
  }
}

export const DataLoader = new DataLoaderClass();