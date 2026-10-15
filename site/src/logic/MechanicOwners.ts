// Mechanic sources for a team: per slot sets, echo, weapon, character, plus System.
import { DataLoader } from '../utils/DataLoader';
import { CommonUtils } from '../utils/Common';
import { SYSTEM_NAMESPACE } from '../utils/MechanicKey';
import { SLOT_SET_FIELDS } from '../utils/TeamUtils';
import type { MechanicNode, TeamSlot } from '../types';

export type MechanicOwnerKind = 'character' | 'echo' | 'weapon' | 'set' | 'system';

export interface MechanicOwner {
  // mechanicsIndex key.
  name: string;
  kind: MechanicOwnerKind;
  // Listener context and @Equipper.
  equipper: string;
  listens: (mech: MechanicNode, key: string) => boolean;
  transform?: (mech: MechanicNode) => MechanicNode;
  allowDirectNode?: boolean;
}

// Tie-break order for same-input moves.
export const OWNER_KIND_ORDER: MechanicOwnerKind[] = ['character', 'echo', 'weapon', 'set', 'system'];

const isPassive = (mech: MechanicNode) => !!mech.isPassive;

const meetsPieceCount = (mech: MechanicNode, pieces: number) => {
  const need = parseInt((mech.category || '').match(/^(\d+)-pc/)?.[1] || '0', 10);
  return !(need > 0 && need > pieces);
};

const applyRank = (mech: MechanicNode, rank: number): MechanicNode => {
  const ranked = JSON.parse(JSON.stringify(mech));
  if (ranked.effects) {
    ranked.effects = ranked.effects.map((e: any) => ({ ...e, value: CommonUtils.parseRankValue(e.value, rank) }));
  }
  return ranked;
};

export function getMechanicOwners(team: TeamSlot[]): MechanicOwner[] {
  const owners: MechanicOwner[] = [];

  team.forEach(slot => {
    if (!slot.character) return;
    const pieces = DataLoader.resolveSetPieceCounts(slot);
    const equipper = slot.character;

    SLOT_SET_FIELDS.forEach(field => {
      const name = slot[field];
      const count = pieces[field];
      if (name && count > 0) {
        owners.push({ name, kind: 'set', equipper, allowDirectNode: true, listens: mech => isPassive(mech) && meetsPieceCount(mech, count) });
      }
    });

    if (slot.mainEcho) owners.push({ name: slot.mainEcho, kind: 'echo', equipper, allowDirectNode: true, listens: isPassive });
    if (slot.weapon) {
      owners.push({ name: slot.weapon, kind: 'weapon', equipper, allowDirectNode: true, listens: isPassive, transform: mech => applyRank(mech, slot.rank) });
    }
    // Outros listen: their trigger rule schedules them.
    owners.push({ name: slot.character, kind: 'character', equipper, listens: (mech, key) => isPassive(mech) || key === `${slot.character}_Outro` });
  });

  owners.push({ name: SYSTEM_NAMESPACE, kind: 'system', equipper: SYSTEM_NAMESPACE, listens: isPassive });
  return owners;
}

// Stats an owner's mechanics read via @Self.Stat(...).
export function selfStatsReadBy(ownerName: string): Set<string> {
  const stats = new Set<string>();
  (DataLoader.mechanicsIndex[ownerName] || []).forEach(key => {
    const mech = DataLoader.mechanicsDB[key];
    const values = [...(mech?.effects || []).map(eff => eff.value), ...(mech?.hitMults || [])];
    values.forEach(value => {
      for (const match of String(value ?? '').matchAll(/@Self\.Stat\((\w+)\)/g)) stats.add(match[1]);
    });
  });
  return stats;
}

export function getCastableMechanics(owner: MechanicOwner): Array<{ key: string; mech: MechanicNode }> {
  return (DataLoader.mechanicsIndex[owner.name] || []).flatMap(key => {
    const mech = DataLoader.mechanicsDB[key];
    return mech && !mech.isPassive ? [{ key, mech }] : [];
  });
}
