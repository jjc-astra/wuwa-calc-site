import { CommonUtils } from './Common';
import type { CharacterData, WeaponData, MechanicNode, TeamSlot } from '../types/index';
import type { RotationResults } from '../types/results';

export interface CharacterResultData {
  rotation: any[];
  team: TeamSlot[];
  settings: { startEnergy?: boolean; startConcerto?: boolean };
  rotationType: 'linear' | 'quickswap' | null;
  // Present when the file was produced by History's "Save Results" -- lets the Rankings loader
  // skip re-running the calc worker for this entry entirely. Absent for a plain Export Rotation
  // file, which only ever has rotation/team/settings. dmgOverTimeSeries is deliberately left
  // out of what Save Results writes (nothing reads it from a saved file, and it's cheap to
  // regenerate via a real recalculate if it's ever needed), so it isn't guaranteed to be here
  // even when the rest of results is.
  results?: Omit<RotationResults, 'dmgOverTimeSeries'>;
}

export class DataLoaderClass {
  cache = { mechanics: new Set<string>() };
  characterDB: Record<string, CharacterData> = {};
  weaponDB: Record<string, WeaponData> = {};
  buildDB: Record<string, any> = {};
  mechanicsDB: Record<string, MechanicNode> = {};
  mechanicsIndex: Record<string, string[]> = {};
  charList: string[] = [];
  // Submitted rotation results for the Rankings page, keyed by filename -- loaded lazily (see
  // loadCharacterResults below), not as part of initDatabases, since unlike the four fixed
  // db_*.json files this folder is expected to grow and only the Rankings page needs it.
  characterResults: Record<string, CharacterResultData> = {};
  weaponsByType: Record<string, string[]> = {
    Broadblade: [], Sword: [], Rectifier: [], Gauntlets: [], Pistols: []
  };

  sonataSets: string[] = [];
  setEchoMapping: Record<string, string[]> = {};
  allMainEchoes: string[] = [];
  triggerSets: string[] = [];

  async loadJSON<T>(path: string): Promise<T | null> {
    try {
      const res = await fetch(`${path}?t=${new Date().getTime()}`);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return await res.json();
    } catch (e) {
      console.error(`[DataLoader] Failed to load JSON from ${path}.`, e);
      return null;
    }
  }

  async initDatabases(): Promise<void> {
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

  // Loads every mechanic a team composition needs (each slot's character/weapon/sets/echo) --
  // shared by the roster store (main thread) and the calc worker, which has its own separate
  // DataLoader instance and so can't just read what the main thread already loaded.
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
    const fileName = itemName.replace(/\s+/g, '_');
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

  // Loads every submitted rotation result for the Rankings page. There's no way to list a
  // public/ folder's contents at runtime, so a hand-maintained manifest (index.json, just an
  // array of filenames + an optional rotationType tag) stands in for directory listing --
  // same shape of problem loadMechanic solves for one named file, just batched over a manifest.
  // Cached by filename the same way loadMechanic caches by folder/itemName, so re-calling this
  // (e.g. re-mounting the Rankings page) doesn't re-fetch files already loaded.
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
    const fileName = itemName.replace(/\s+/g, '_');
    const cacheKey = `${folder}/${fileName}`;

    // 1. Evict from cache Set so loadMechanic will re-fetch the JSON file
    this.cache.mechanics.delete(cacheKey);

    // 2. Remove modified in-memory keys
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