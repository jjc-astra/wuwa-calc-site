// Every source of mechanics for a team: each slot's echo sets, main echo, weapon and character,
// plus the team-independent System. TimelineEngine registers their passives as event listeners,
// and the rotation row's action dropdown lists their castable moves -- both read this one list.
import { DataLoader } from '../utils/DataLoader';
import { CommonUtils } from '../utils/Common';
import { SYSTEM_NAMESPACE } from '../utils/MechanicKey';
import type { MechanicNode, TeamSlot } from '../types';

export type MechanicOwnerKind = 'character' | 'echo' | 'weapon' | 'set' | 'system';

export interface MechanicOwner {
  // The mechanicsIndex key its nodes live under.
  name: string;
  kind: MechanicOwnerKind;
  // Whose context the listeners evaluate in, and what @Equipper resolves to.
  equipper: string;
  // Whether a node listens for events. Castable moves are cast from rows instead.
  listens: (mech: MechanicNode, key: string) => boolean;
  transform?: (mech: MechanicNode) => MechanicNode;
  // Falls back to a single node named after the owner when it has no indexed nodes.
  allowDirectNode?: boolean;
}

// Lists castable moves in this order, so a tie between same-input moves resolves the same way everywhere.
export const OWNER_KIND_ORDER: MechanicOwnerKind[] = ['character', 'echo', 'weapon', 'set', 'system'];

const isPassive = (mech: MechanicNode) => !!mech.isPassive;

// "N-pc" nodes only apply once the slot wears at least N pieces of the set.
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

// Every owner for a team: per slot its sets, main echo, weapon and character, then System.
export function getMechanicOwners(team: TeamSlot[]): MechanicOwner[] {
  const owners: MechanicOwner[] = [];

  team.forEach(slot => {
    if (!slot.character) return;
    const pieces = DataLoader.resolveSetPieceCounts(slot);
    const equipper = slot.character;

    const set = (name: string, count: number) => {
      if (name && count > 0) {
        owners.push({ name, kind: 'set', equipper, allowDirectNode: true, listens: mech => isPassive(mech) && meetsPieceCount(mech, count) });
      }
    };
    set(slot.mainSet, pieces.mainSet);
    set(slot.subSet, pieces.subSet);
    set(slot.subSet2a, pieces.subSet2a);
    set(slot.subSet2b, pieces.subSet2b);

    if (slot.mainEcho) owners.push({ name: slot.mainEcho, kind: 'echo', equipper, allowDirectNode: true, listens: isPassive });
    if (slot.weapon) {
      owners.push({ name: slot.weapon, kind: 'weapon', equipper, allowDirectNode: true, listens: isPassive, transform: mech => applyRank(mech, slot.rank) });
    }
    // A character's Outro listens too: its trigger rule is what schedules it.
    owners.push({ name: slot.character, kind: 'character', equipper, listens: (mech, key) => isPassive(mech) || key === `${slot.character}_Outro` });
  });

  // Not owned by any slot, so it registers once under a synthetic equipper.
  owners.push({ name: SYSTEM_NAMESPACE, kind: 'system', equipper: SYSTEM_NAMESPACE, listens: isPassive });
  return owners;
}

// The moves an owner contributes to a row's action dropdown, in index order.
export function getCastableMechanics(owner: MechanicOwner): Array<{ key: string; mech: MechanicNode }> {
  return (DataLoader.mechanicsIndex[owner.name] || []).flatMap(key => {
    const mech = DataLoader.mechanicsDB[key];
    return mech && !mech.isPassive ? [{ key, mech }] : [];
  });
}
