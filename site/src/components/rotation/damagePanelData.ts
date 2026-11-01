// Buff card grouping and labels for DamageBreakdownPanel.
import type { TeamSlot } from '../../types';
import { CommonUtils } from '../../utils/Common';
import { MechanicKey, SYSTEM_NAMESPACE } from '../../utils/MechanicKey';
import { effectTarget, type BuilderTarget } from '../../utils/builderLinks';
import { slotSets } from '../../utils/TeamUtils';

export interface BuffRow {
  label: string;
  value: any;
  stacks: number;
}

export interface BuffCardData {
  effects: BuffRow[];
  // One Builder target per entity on the card (a main echo shares its set's card).
  details: BuilderTarget[];
}

const tokenize = (str: string): string[] => (str || '')
  .toLowerCase()
  .replace(/_/g, ' ')
  .replace(/\bs([1-6])\b/g, 'sequence $1')
  .replace(/\bseq\b/g, 'sequence')
  .replace(/[^a-z0-9\s]/g, ' ')
  .split(/\s+/)
  .filter(Boolean);

const NOISE_WORDS = [
  'buff', 'effect', 'slot', 'main', 'stat', 'bonus', 'amp', 'tier',
  'team', 'self', 'next', 'active', 'enemy', 'others', 'all', 'group'
];

const escapeForRegex = (text: string) => text.replace(/[^a-zA-Z0-9]/g, '\\$&');
const trimSeparators = (text: string) => text.replace(/^[-:_:=]+\s*/, '').replace(/\s*[-:_:=]+$/, '').trim();

// Card for a buff: weapon, set, main echo, else its source mechanic.
function cardHeaderFor(b: any, sourceMech: string, slot: TeamSlot, weaponNames: string[]): string {
  // A set's own effects: its card, so sub sets don't join the main set's.
  if (b.sourceOwner && slotSets(slot).includes(b.sourceOwner)) return b.sourceOwner;

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

// Row label: the effect name minus redundant words, else the stat.
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

// Per entity: search the one effect name or applying mechanic its effects share.
function cardDetails(targets: Array<BuilderTarget | null>): BuilderTarget[] {
  const unique = (values: Array<string | undefined>) => [...new Set(values.filter((v): v is string => !!v))];
  const known = targets.filter((t): t is BuilderTarget => !!t);
  return unique(known.map(t => t.entity)).map(entity => {
    const same = known.filter(t => t.entity === entity);
    const names = unique(same.map(t => t.search));
    const sources = unique(same.map(t => t.flash));
    const search = names.length === 1 ? names[0] : sources.length === 1 ? MechanicKey.parse(sources[0]).name || sources[0] : '';
    return { entity, search, flash: sources[0] };
  });
}

/** A unit's active buffs grouped into cards. `weaponNames`: every weapon in the game. */
export function groupBuffsBySource(
  unitBuffs: any[],
  slot: TeamSlot,
  unitName: string,
  weaponNames: string[]
): Record<string, BuffCardData> {
  const grouped: Record<string, { effects: BuffRow[]; targets: Array<BuilderTarget | null> }> = {};

  unitBuffs.forEach(b => {
    const sourceMech = (b.source || SYSTEM_NAMESPACE).replace(/_/g, ' ').trim();
    const cardHeader = cardHeaderFor(b, sourceMech, slot, weaponNames);
    if (!grouped[cardHeader]) grouped[cardHeader] = { effects: [], targets: [] };

    let displayVal = b.value !== undefined ? b.value : '-';
    if (typeof b.value === 'number' && b.value > 0 && b.value < 1) {
      displayVal = `${CommonUtils.trimNumber(b.value * 100, 2)}%`;
    }

    grouped[cardHeader].effects.push({
      label: rowLabelFor(b, sourceMech, cardHeader, unitName),
      value: displayVal,
      stacks: b.stacks || 1
    });
    grouped[cardHeader].targets.push(effectTarget(b));
  });

  return Object.fromEntries(Object.entries(grouped).map(([header, { effects, targets }]) => [header, { effects, details: cardDetails(targets) }]));
}
