import { CommonUtils } from './Common';
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
  // Content-hash manifest (public/data/manifest.json). Detects changed data files without
  // re-downloading. See dataFreshness.ts.
  manifest: Record<string, string> = {};
  // Hash recorded at last fetch -- vs a fresh manifest, tells "changed" from "never loaded"/"unchanged".
  loadedHashes: Record<string, string> = {};
  private manifestFetchedAt = 0;
  characterDB: Record<string, CharacterData> = {};
  weaponDB: Record<string, WeaponData> = {};
  buildDB: Record<string, any> = {};
  mechanicsDB: Record<string, MechanicNode> = {};
  mechanicsIndex: Record<string, string[]> = {};
  charList: string[] = [];
  // Rankings page's submitted results, loaded lazily (loadCharacterResults) -- not part of initDatabases.
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
      // Records the manifest hash as "what we loaded" -- not a hash of `data` (that'd trivially always match).
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
    const data = await this.loadJSON<Record<string, MechanicNode>>(CommonUtils.getData(this.mechanicPath(folder, itemName)));
    if (data) {
      for (const [key, mechData] of Object.entries(data)) {
        this.registerMechanicNode(key, mechData);
      }
      this.cache.mechanics.add(cacheKey);
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