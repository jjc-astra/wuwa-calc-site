import { CommonUtils, DATA_REPO_BASE_URL, WIP_BASE_URL } from './Common';
import type { CharacterData, WeaponData, MechanicNode, TeamSlot, HoldConfig } from '../types/index';
import type { RotationResults } from '../types/results';

// Gates content with no real mechanics yet: disabled in the Rotation Calculator, still
// selectable in the Builder. Toggle during content authoring.
export const DISABLE_UNIMPLEMENTED_CONTENT = true;

export type ImplementedContentKind = 'character' | 'weapon' | 'set' | 'echo';
const MECHANIC_FOLDER_BY_KIND: Record<ImplementedContentKind, string> = {
  character: 'characters', weapon: 'weapons', set: 'sets', echo: 'echoes'
};

export interface CharacterResultData {
  rotation: any[];
  team: TeamSlot[];
  settings: { startEnergy?: boolean; startConcerto?: boolean; endingRotationEnabled?: boolean; endRotationStartsEarlier?: boolean };
  rotationType: 'linear' | 'quickswap' | null;
  // Free-text credit from the Save Results dialog. Optional -- older saved files just render with no author tag.
  author?: string;
  // Set when saved via History's "Save Results" -- lets Rankings skip the calc worker.
  // Absent for a plain Export. dmgOverTimeSeries is always omitted (cheap to regenerate).
  results?: Omit<RotationResults, 'dmgOverTimeSeries'>;
}

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
  mechanicsIndex: Record<string, string[]> = {};
  charList: string[] = [];
  // Submitted rankings page results, lazily populated via loadCharacterResults rather than initDatabases.
  characterResults: Record<string, CharacterResultData> = {};
  weaponsByType: Record<string, string[]> = {
    Broadblade: [], Sword: [], Rectifier: [], Gauntlets: [], Pistols: []
  };

  sonataSets: string[] = [];
  setEchoMapping: Record<string, string[]> = {};
  allMainEchoes: string[] = [];
  triggerSets: string[] = [];

  private async _fetchJSON<T>(path: string, silent = false): Promise<T | null> {
    try {
      const res = await fetch(`${path}?t=${new Date().getTime()}`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const text = await res.text();
      // Vite's dev server serves index.html (200 OK, not a 404) for ANY path under public/ that
      // doesn't exist -- its SPA history fallback. A missing WIP file hits this constantly, so
      // check for it explicitly (JSON never starts with '<') instead of letting JSON.parse's
      // syntax error do the job by accident.
      if (/^\s*</.test(text)) throw new Error('Received HTML, not JSON (path does not exist).');
      return JSON.parse(text) as T;
    } catch (e) {
      if (!silent) console.error(`[DataLoader] Failed to load JSON from ${path}.`, e);
      return null;
    }
  }

  // A dev build's `path` (from getData/getImage) points at the local WIP mirror first -- a
  // path this specific entity doesn't have a WIP override for doesn't resolve there (see
  // _fetchJSON), silently, and this falls back to the real data repo. A prod build's `path` is
  // already the real repo, so this is a same-URL no-op fetch that never runs (isWipAttempt is
  // always false).
  async loadJSON<T>(path: string, opts: { skipHashTracking?: boolean } = {}): Promise<T | null> {
    const isWipAttempt = import.meta.env.DEV && path.startsWith(WIP_BASE_URL);
    let usedPath = path;
    let data = await this._fetchJSON<T>(path, isWipAttempt);
    const servedFromWip = isWipAttempt && data !== null;
    if (data === null && isWipAttempt) {
      usedPath = path.replace(WIP_BASE_URL, DATA_REPO_BASE_URL);
      data = await this._fetchJSON<T>(usedPath);
    }
    // Records the manifest hash as loaded content, or flags dev WIP paths lacking a manifest baseline.
    if (data !== null && !opts.skipHashTracking) {
      if (servedFromWip) {
        this.wipSourced.add(path.replace(`${WIP_BASE_URL}/data/`, ''));
      } else {
        const relPath = usedPath.replace(`${DATA_REPO_BASE_URL}/data/`, '');
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
    const real = (await this.loadJSON<T>(CommonUtils.getRealData(relPath))) || ({} as T);
    if (!import.meta.env.DEV) return real;
    const wip = await this._fetchJSON<T>(CommonUtils.getWipData(relPath), true);
    return wip ? ({ ...real, ...wip } as T) : real;
  }

  // On-disk filename for a mechanic entity. Rest of the app calls the Generic/System entity
  // 'Generic', but the real file is lowercase generic.json -- this is the one place that translates.
  private mechanicFileName(itemName: string): string {
    return itemName === 'Generic' ? 'generic' : itemName.replace(/\s+/g, '_');
  }

  // Same relPath convention loadMechanic uses internally, exposed for dataFreshness.ts.
  mechanicPath(folder: string, itemName: string): string {
    return `mechanics/${folder}/${this.mechanicFileName(itemName)}.json`;
  }

  // cache.mechanics key for (folder, itemName) -- combines folder with mechanicFileName's
  // Generic->'generic' translation, so every caller agrees on the same key regardless of casing.
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
    this.triggerSets = echoData.TRIGGER_SETS || [];

    await this.loadMechanic('generic', 'generic');
    this.resolveReady();
  }

  // Loads every mechanic a team needs. Shared by the roster store and the calc worker's own
  // separate DataLoader instance.
  //
  // Generic/System (Dodge, Jump, Tune Break...) applies regardless of team, so it's always
  // loaded here -- calc.worker.ts's builder-override path clears it first and relies on this to restore it.
  async loadTeamMechanics(team: Array<{ character?: string; weapon?: string; mainSet?: string; subSet?: string; mainEcho?: string }>): Promise<void> {
    await this.loadMechanic('generic', 'generic');
    for (const slot of team) {
      if (slot.character) await this.loadMechanic('characters', slot.character);
      if (slot.weapon) await this.loadMechanic('weapons', slot.weapon);
      if (slot.mainSet) await this.loadMechanic('sets', slot.mainSet);
      if (slot.subSet) await this.loadMechanic('sets', slot.subSet);
      if (slot.mainEcho) await this.loadMechanic('echoes', slot.mainEcho);
    }
  }

  async loadMechanic(folder: string, itemName: string): Promise<void> {
    if (!itemName) return;
    const cacheKey = this.mechanicCacheKey(folder, itemName);
    if (this.cache.mechanics.has(cacheKey)) return;
    const cooldownUntil = this.missingUntil.get(cacheKey);
    if (cooldownUntil && Date.now() < cooldownUntil) return;
    const data = await this.loadJSON<Record<string, MechanicNode>>(CommonUtils.getData(this.mechanicPath(folder, itemName)));
    if (data) {
      for (const [key, mechData] of Object.entries(data)) {
        this.registerMechanicNode(key, mechData);
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
    const indexKey = key.startsWith('System_') ? 'System' : key.split('_')[0];
    if (!this.mechanicsIndex[indexKey]) this.mechanicsIndex[indexKey] = [];
    if (!this.mechanicsIndex[indexKey].includes(key)) this.mechanicsIndex[indexKey].push(key);
  }

  unregisterMechanicNode(key: string): void {
    delete this.mechanicsDB[key];
    const indexKey = key.startsWith('System_') ? 'System' : key.split('_')[0];
    if (this.mechanicsIndex[indexKey]) {
      this.mechanicsIndex[indexKey] = this.mechanicsIndex[indexKey].filter(k => k !== key);
    }
  }

  // Finds a character's Hold "Release" mechanic (the one carrying holdConfig) -- optionally
  // scoped to a specific `input` binding, since a dual-mode character can have two separate
  // Hold mechanics (one per mode) that would otherwise be ambiguous to tell apart. Shared by
  // TimelineEngine (auto-wait/live cursor tracking) and Gauge.tsx (display preview) so the
  // lookup can't quietly diverge between the two.
  findHoldReleaseConfig(charName: string, matchInput?: string): HoldConfig | null {
    const releaseKey = Object.keys(this.mechanicsDB).find(k => {
      const m = this.mechanicsDB[k];
      if (!k.startsWith(`${charName}_`) || m.inputType !== 'Release' || !m.holdConfig) return false;
      if (matchInput !== undefined && m.input !== matchInput) return false;
      return true;
    });
    return releaseKey ? (this.mechanicsDB[releaseKey].holdConfig as HoldConfig) : null;
  }

  // Loads every submitted result for Rankings. index.json (filenames + optional rotationType)
  // stands in for a directory listing (public/ can't be listed at runtime). Cached by filename.
  async loadCharacterResults(): Promise<string[]> {
    const manifest = await this.loadJSON<Array<{ file: string; rotationType?: 'linear' | 'quickswap' | null }>>(
      CommonUtils.getData('character_results/index.json')
    ) || [];
    for (const entry of manifest) {
      if (this.characterResults[entry.file]) continue;
      const data = await this.loadJSON<Omit<CharacterResultData, 'rotationType'>>(
        CommonUtils.getData(`character_results/${entry.file}`)
      );
      if (data) this.characterResults[entry.file] = { ...data, rotationType: entry.rotationType ?? null };
    }
    return Object.keys(this.characterResults);
  }

  clearMechanicCache(folder: string, itemName: string): void {
    if (!itemName) return;
    const cacheKey = this.mechanicCacheKey(folder, itemName);

    this.cache.mechanics.delete(cacheKey);
    this.missingUntil.delete(cacheKey);
    this.wipSourced.delete(this.mechanicPath(folder, itemName));

    Object.keys(this.mechanicsDB).forEach(key => {
      if (key.startsWith(itemName + '_') || (itemName === 'Generic' && key.startsWith('System_'))) {
        delete this.mechanicsDB[key];
      }
    });

    const indexKey = itemName === 'Generic' ? 'System' : itemName;
    delete this.mechanicsIndex[indexKey];
  }
}

export const DataLoader = new DataLoaderClass();