// The numbers behind the per-row damage breakdown panel (DamageBreakdownPanel): what a hit's
// crit/non-crit values are, and which card each active buff belongs on.
import type { TeamSlot } from '../../types';
import { CommonUtils } from '../../utils/Common';

/** A hit's average damage, however the worker happened to store it. */
export function hitAverage(inst: any): number {
  if (typeof inst.avg === 'number') return inst.avg;
  if (typeof inst.total === 'number') return inst.total;
  return parseFloat(String(inst.total || 0).replace(/,/g, '')) || 0;
}

/** The non-crit and crit damage of one hit: the recorded values, or derived from its average
 * and the crit stats it was priced with (average = nonCrit * ((1 - cr) + cr * cd)). */
export function critSplit(inst: any, instData: any, avgVal: number): { nonCritVal: number; critVal: number } {
  if (inst.nonCrit !== undefined && inst.crit !== undefined) return { nonCritVal: inst.nonCrit, critVal: inst.crit };

  let cr = instData.critRate !== undefined ? instData.critRate : 0;
  let cd = instData.critDmg !== undefined ? instData.critDmg : 150;
  if (typeof cr === 'string') cr = parseFloat(cr) || 0;
  if (cr > 1) cr = cr / 100;
  cr = Math.min(1.0, Math.max(0.0, cr));
  if (typeof cd === 'string') cd = parseFloat(cd) || 150;
  if (cd > 10) cd = cd / 100;
  const critMult = (1 - cr) + cr * cd;
  if (critMult <= 0) return { nonCritVal: avgVal, critVal: avgVal };
  const nonCritVal = avgVal / critMult;
  return { nonCritVal, critVal: nonCritVal * cd };
}

export interface BuffRow {
  label: string;
  value: any;
  stacks: number;
}

const tokenize = (str: string): string[] => (str || '')
  .toLowerCase()
  .replace(/_/g, ' ')
  .replace(/\bs([1-6])\b/g, 'sequence $1')
  .replace(/\bseq\b/g, 'sequence')
  .replace(/[^a-z0-9\s]/g, ' ')
  .split(/\s+/)
  .filter(Boolean);

// Words that say nothing about which effect a buff is.
const NOISE_WORDS = [
  'buff', 'effect', 'slot', 'main', 'stat', 'bonus', 'amp', 'tier',
  'team', 'self', 'next', 'active', 'enemy', 'others', 'all', 'group'
];

const escapeForRegex = (text: string) => text.replace(/[^a-zA-Z0-9]/g, '\\$&');
const trimSeparators = (text: string) => text.replace(/^[-:_:=]+\s*/, '').replace(/\s*[-:_:=]+$/, '').trim();

// Which card a buff sits on: the weapon, a set, the main echo, or (failing those) its source mechanic.
function cardHeaderFor(b: any, sourceMech: string, slot: TeamSlot, weaponNames: string[]): string {
  const wepName = slot.weapon ? slot.weapon.trim() : '';
  const mainSet = slot.mainSet ? slot.mainSet.trim() : '';
  const subSet = slot.subSet ? slot.subSet.trim() : '';
  const mainEcho = slot.mainEcho ? slot.mainEcho.trim() : '';

  let cardHeader = sourceMech;
  const lowerSource = sourceMech.toLowerCase();

  if (wepName && lowerSource.includes(wepName.toLowerCase())) {
    cardHeader = wepName;
  } else {
    const matchedWep = weaponNames.find(w => lowerSource.startsWith(w.toLowerCase()));
    if (matchedWep) cardHeader = matchedWep;
  }

  const isSetEffect = lowerSource.includes('2-pc') || lowerSource.includes('3-pc') || lowerSource.includes('5-pc') ||
                      lowerSource.includes('2 pc') || lowerSource.includes('3 pc') || lowerSource.includes('5 pc');

  const isMainEcho = mainEcho && (
    lowerSource.includes(mainEcho.toLowerCase()) ||
    (b.name && b.name.toLowerCase().includes(mainEcho.toLowerCase()))
  );

  if (isSetEffect) {
    const lowerEffName = (b.name || '').toLowerCase();
    if (subSet && (lowerSource.includes(subSet.toLowerCase()) || lowerEffName.includes(subSet.toLowerCase()))) {
      cardHeader = subSet;
    } else if (mainSet && (lowerSource.includes(mainSet.toLowerCase()) || lowerEffName.includes(mainSet.toLowerCase()))) {
      cardHeader = mainSet;
    } else {
      const is3Pc = lowerSource.includes('3-pc') || lowerSource.includes('3 pc') || lowerEffName.includes('3-pc');
      const is2Pc = lowerSource.includes('2-pc') || lowerSource.includes('2 pc') || lowerEffName.includes('2-pc');
      if (is3Pc) {
        cardHeader = mainSet || '3-pc Set';
      } else if (is2Pc && subSet) {
        cardHeader = subSet;
      } else if (mainSet) {
        cardHeader = mainSet;
      }
    }
  } else if (isMainEcho) {
    cardHeader = mainSet || mainEcho;
  }
  return cardHeader;
}

// What a buff's row says: its stat, or the effect's name with everything the card and stat already
// say stripped out (falling back to the stat when nothing distinct is left).
function rowLabelFor(b: any, sourceMech: string, cardHeader: string, unitName: string): string {
  const knownWords = new Set([...tokenize(cardHeader), ...tokenize(unitName), ...tokenize(b.stat), ...NOISE_WORDS]);

  let rawEffName = (b.name || sourceMech).replace(/_/g, ' ').trim();
  if (unitName) {
    const unitRegex = new RegExp(`^${escapeForRegex(unitName)}\\s*[-:_]?\\s*`, 'i');
    rawEffName = rawEffName.replace(unitRegex, '').trim();
  }

  let cleanEffName = rawEffName;
  if (cardHeader && cardHeader.toLowerCase() !== rawEffName.toLowerCase()) {
    const headerRegex = new RegExp(`\\b${escapeForRegex(cardHeader)}\\b`, 'gi');
    cleanEffName = cleanEffName.replace(headerRegex, '').trim();
  }

  cleanEffName = trimSeparators(cleanEffName);
  let displayEffName = cleanEffName;

  if (b.stat) {
    tokenize(b.stat).forEach(st => {
      if (st.length > 1) {
        const stRegex = new RegExp(`\\b${escapeForRegex(st)}\\b`, 'gi');
        displayEffName = displayEffName.replace(stRegex, '').trim();
      }
    });
  }
  displayEffName = trimSeparators(displayEffName);

  const uniqueTokens = tokenize(cleanEffName).filter(w => !knownWords.has(w));
  const isRedundant = uniqueTokens.length === 0 || !displayEffName;
  if (isRedundant) return b.stat || cleanEffName || rawEffName || 'Effect';
  return b.stat ? `${displayEffName} (${b.stat})` : displayEffName;
}

/** One unit's active buffs, grouped into the cards they're shown on (a weapon, a set, the main
 * echo, or a mechanic), each buff a labelled row. `weaponNames` are every weapon in the game, so a
 * buff sourced from a weapon the slot doesn't hold (another unit's) still lands on that weapon's card. */
export function groupBuffsBySource(
  unitBuffs: any[],
  slot: TeamSlot,
  unitName: string,
  weaponNames: string[]
): Record<string, { effects: BuffRow[] }> {
  const grouped: Record<string, { effects: BuffRow[] }> = {};

  unitBuffs.forEach(b => {
    const sourceMech = (b.source || 'System').replace(/_/g, ' ').trim();
    const cardHeader = cardHeaderFor(b, sourceMech, slot, weaponNames);
    if (!grouped[cardHeader]) grouped[cardHeader] = { effects: [] };

    let displayVal = b.value !== undefined ? b.value : '-';
    if (typeof b.value === 'number' && b.value > 0 && b.value < 1) {
      displayVal = `${CommonUtils.trimNumber(b.value * 100, 2)}%`;
    }

    grouped[cardHeader].effects.push({
      label: rowLabelFor(b, sourceMech, cardHeader, unitName),
      value: displayVal,
      stacks: b.stacks || 1
    });
  });

  return grouped;
}
