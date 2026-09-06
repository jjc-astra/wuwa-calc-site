import { CommonUtils } from './Common';
import type { CharacterData, WeaponData, MechanicNode, TeamSlot } from '../types/index';
import type { RotationResults } from '../types/results';

// Master switch gating content with no real mechanics data yet -- disabled/greyed out in the
// Rotation Calculator, still selectable in the Mechanics Builder. Flip off during content authoring.
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
  // Present when the file was produced by History's "Save Results", letting the Rankings loader
  // skip re-running the calc worker. Absent for a plain Export Rotation file. dmgOverTimeSeries
  // is left out either way -- cheap to regenerate via a real recalculate.
  results?: Omit<RotationResults, 'dmgOverTimeSeries'>;
}

export class DataLoaderClass {
  cache = { mechanics: new Set<string>() };
  // Content-hash manifest (public/data/manifest.json), letting the app cheaply detect a changed
  // data file without re-downloading it. See dataFreshness.ts for the checks built on this.
  manifest: Record<string, string> = {};
  // The manifest hash recorded when a path was last fetched, compared against a fresh manifest
  // to tell "changed since loaded" apart from "never loaded" or "unchanged".
  loadedHashes: Record<string, string> = {};
  private manifestFetchedAt = 0;
  characterDB: Record<string, CharacterData> = {};
  weaponDB: Record<string, WeaponData> = {};
  buildDB: Record<string, any> = {};
  mechanicsDB: Record<string, MechanicNode> = {};
  mechanicsIndex: Record<string, string[]> = {};
  charList: string[] = [];
  // Submitted rotation results for the Rankings page, loaded lazily (loadCharacterResults),
  // not as part of initDatabases -- only the Rankings page needs this folder.
  characterResults: Record<string, CharacterResultData> = {};
  weaponsByType: Record<string, string[]> = {
    Broadblade: [], Sword: [], Rectifier: [], Gauntlets: [], Pistols: []
  };

  sonataSets: string[] = [];
  setEchoMapping: Record<string, string[]> = {};
  allMainEchoes: string[] = [];
  triggerSets: string[] = [];

  async loadJSON<T>(path: string, opts: { skipHashTracking?: boolean } = {}): Promise<T | null> {
    try {
      const res = await fetch(`${path}?t=${new Date().getTime()}`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      // Records the path's current manifest hash as "what we just loaded" (not a hash of
      // `data` itself, which would tautologically always match).
      if (!opts.skipHashTracking) {
        const relPath = path.replace(/^\/data\//, '');
        if (this.manifest[relPath]) this.loadedHashes[relPath] = this.manifest[relPath];
      }
      return data;
    } catch (e) {
      console.error(`[DataLoader] Failed to load JSON from ${path}.`, e);
      return null;
    }
  }

  // The on-disk filename for a mechanic entity. Every other part of the app refers to the
  // Generic/System entity as 'Generic', but the real file is lowercase generic.json -- this is
  // the one place that translates between the two.
  private mechanicFileName(itemName: string): string {
    return itemName === 'Generic' ? 'generic' : itemName.replace(/\s+/g, '_');
  }

  // Same relPath convention loadMechanic uses internally, exposed for dataFreshness.ts.
  mechanicPath(folder: string, itemName: string): string {
    return `mechanics/${folder}/${this.mechanicFileName(itemName)}.json`;
  }

  // Derived from the manifest (populated before anything can call this -- see App.tsx's
  // initDatabases gate) rather than a hand-maintained list: a mechanics JSON file existing on
  // disk for `name` at app build time is exactly what "implemented" means.
  isContentImplemented(kind: ImplementedContentKind, name: string): boolean {
    if (!DISABLE_UNIMPLEMENTED_CONTENT) return true;
    return !!this.manifest[this.mechanicPath(MECHANIC_FOLDER_BY_KIND[kind], name)];
  }

  // Throttled (5s) so a burst of near-simultaneous callers collapses into one request. `force`
  // bypasses the throttle for the startup call in initDatabases.
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

  // Establishes a loadedHashes baseline for anything already cached that doesn't have one yet
  // (e.g. useRosterStore's rehydration calling loadMechanic before any manifest fetch has
  // started). Runs on every successful manifest fetch so a still-unhashed path gets another chance.
  private backfillLoadedHashes(manifest: Record<string, string>): void {
    for (const cacheKey of this.cache.mechanics) {
      const relPath = `mechanics/${cacheKey}.json`;
      if (!this.loadedHashes[relPath] && manifest[relPath]) {
        this.loadedHashes[relPath] = manifest[relPath];
      }
    }
  }

  async initDatabases(): Promise<void> {
    await this.refreshManifest(true);
    this.characterDB = await this.loadJSON<Record<string, CharacterData>>(CommonUtils.getData('db_characters.json')) || {};
    this.weaponDB = await this.loadJSON<Record<string, WeaponData>>(CommonUtils.getData('db_weapons.json')) || {};
    this.buildDB = await this.loadJSON<Record<string, any>>(CommonUtils.getData('db_builds.json')) || {};

    this.charList = Object.keys(this.characterDB);
    this.weaponsByType = { Broadblade: [], Sword: [], Rectifier: [], Gauntlets: [], Pistols: [] };

    Object.keys(this.weaponDB).forEach(weaponName => {
      const type = this.weaponDB[weaponName].weaponType;
      if (this.weaponsByType[type]) this.weaponsByType[type].push(weaponName);
    });

    const echoData = await this.loadJSON<any>(CommonUtils.getData('db_echoes.json')) || {};
    this.setEchoMapping = echoData.SET_ECHO_MAPPING || {};
    this.sonataSets = Object.keys(this.setEchoMapping);
    this.allMainEchoes = Array.from(new Set(Object.values(this.setEchoMapping).flat()));
    this.triggerSets = echoData.TRIGGER_SETS || [];

    await this.loadMechanic('generic', 'generic');
  }

  // Loads every mechanic a team composition needs. Shared by the roster store and the calc
  // worker, which has its own separate DataLoader instance.
  async loadTeamMechanics(team: Array<{ character?: string; weapon?: string; mainSet?: string; subSet?: string; mainEcho?: string }>): Promise<void> {
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
    const fileName = this.mechanicFileName(itemName);
    const cacheKey = `${folder}/${fileName}`;
    if (this.cache.mechanics.has(cacheKey)) return;
    const data = await this.loadJSON<Record<string, MechanicNode>>(CommonUtils.getData(`mechanics/${folder}/${fileName}.json`));
    if (data) {
      for (const [key, mechData] of Object.entries(data)) {
        this.mechanicsDB[key] = mechData;
        const indexKey = key.startsWith('System_') ? 'System' : key.split('_')[0];
        if (!this.mechanicsIndex[indexKey]) this.mechanicsIndex[indexKey] = [];
        if (!this.mechanicsIndex[indexKey].includes(key)) this.mechanicsIndex[indexKey].push(key);
      }
      this.cache.mechanics.add(cacheKey);
    }
  }

  // Loads every submitted rotation result for the Rankings page. index.json (filenames +
  // optional rotationType) stands in for a directory listing, since public/ can't be listed
  // at runtime. Cached by filename so re-mounting the Rankings page doesn't re-fetch.
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
    // Must use mechanicFileName's translation, or this eviction misses the cache-Set entry
    // loadMechanic actually inserted and the next load silently skips re-fetching.
    const cacheKey = `${folder}/${this.mechanicFileName(itemName)}`;

    this.cache.mechanics.delete(cacheKey);

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