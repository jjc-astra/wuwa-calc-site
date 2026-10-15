// Cosmetic DSL tokenizer for input highlighting; never feeds DSLParser.
import { DSL_POINTERS } from '../logic/dsl/dslRegistry';

export interface DSLToken {
  text: string;
  color: string;
  /** Unknown @Pointer or .Property. */
  invalid?: boolean;
}

const BRACKET_COLORS = ['#ffd700', '#da70d6', '#00bfff', '#7fd88f', '#ff7f50'];

const KEYWORD_COLOR = '#c678dd';
const EVENT_COLOR = '#dca54c';
const POINTER_COLOR = '#61afef';
const PROPERTY_COLOR = '#56b6c2';
const NUMBER_COLOR = '#98c379';
const OPERATOR_COLOR = '#9aa0a8';
const DEFAULT_COLOR = 'var(--text-main)';

const POINTER_NAMES = new Set(Object.keys(DSL_POINTERS));

// Forte{N}/MaxForte{N} aren't in the registry; validated by shape.
const DYNAMIC_FORTE_PROPERTY = /^(Max)?Forte[0-9]+$/;

function isValidProperty(pointerName: string, propText: string, extraSelfProperties: string[]): boolean {
  if (pointerName === 'Self' && (DYNAMIC_FORTE_PROPERTY.test(propText) || extraSelfProperties.includes(propText))) return true;
  const pointer = DSL_POINTERS[pointerName];
  if (!pointer) return false;
  return pointer.properties.some(p => p.propName.replace(/\(\)$/, '') === propText);
}

// Groups: pointer, property, keyword, event, operator, bracket, number.
// Pointers try "@Namespace(" (spaces allowed) before plain "@Word".
const TOKEN_REGEX =
  /(@[A-Za-z_][A-Za-z0-9_]*(?:\s[A-Za-z0-9_]+)*(?=\()|@[A-Za-z_][A-Za-z0-9_]*)|(\.[A-Za-z_][A-Za-z0-9_]*)|(\b(?:IF|AND|OR|NOT|ANY|ALL|XOR|ALWAYS|MATH|ABS)\b)|(\b(?:On|After)[A-Za-z]*\b)|(&&|\|\||==|!=|>=|<=|\.\.|[<>+\-*/%])|([()[\]])|(-?\d+(?:\.\d+)?%?)/gi;

// extraSelfProperties: per-character @Self properties.
export function tokenizeDSL(input: string, extraSelfProperties: string[] = []): DSLToken[] {
  if (!input) return [];

  const tokens: DSLToken[] = [];
  let lastIndex = 0;
  let depth = 0;

  // chainStep 1: next .word is a property; 2+: native methods (not validated).
  let activePointer: string | null = null;
  let chainStep = 0;

  TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_REGEX.exec(input)) !== null) {
    const contiguous = match.index === lastIndex;
    if (match.index > lastIndex) {
      tokens.push({ text: input.slice(lastIndex, match.index), color: DEFAULT_COLOR });
    }

    const [full, pointer, property, keyword, event, operator, bracket, number] = match;

    if (pointer) {
      const followedByCall = input[match.index + full.length] === '(';
      const pointerName = full.slice(1);
      if (followedByCall) {
        // Namespace call; not validated.
        tokens.push({ text: full, color: POINTER_COLOR });
        activePointer = null;
        chainStep = 0;
      } else {
        const valid = POINTER_NAMES.has(pointerName);
        tokens.push({ text: full, color: POINTER_COLOR, invalid: !valid });
        activePointer = valid ? pointerName : null;
        chainStep = 1;
      }
    } else if (property) {
      if (contiguous && activePointer && chainStep === 1) {
        const valid = isValidProperty(activePointer, full.slice(1), extraSelfProperties);
        tokens.push({ text: full, color: PROPERTY_COLOR, invalid: !valid });
        chainStep = 2;
      } else {
        // Native method or detached .word; not validated.
        tokens.push({ text: full, color: PROPERTY_COLOR });
        if (!contiguous) { activePointer = null; chainStep = 0; }
      }
    } else if (keyword) {
      tokens.push({ text: full, color: KEYWORD_COLOR });
      activePointer = null;
      chainStep = 0;
    } else if (event) {
      tokens.push({ text: full, color: EVENT_COLOR });
      activePointer = null;
      chainStep = 0;
    } else if (operator) {
      tokens.push({ text: full, color: OPERATOR_COLOR });
      activePointer = null;
      chainStep = 0;
    } else if (bracket) {
      if (bracket === '(' || bracket === '[') {
        tokens.push({ text: full, color: BRACKET_COLORS[depth % BRACKET_COLORS.length] });
        depth++;
      } else {
        depth = Math.max(0, depth - 1);
        tokens.push({ text: full, color: BRACKET_COLORS[depth % BRACKET_COLORS.length] });
      }
      activePointer = null;
      chainStep = 0;
    } else if (number) {
      tokens.push({ text: full, color: NUMBER_COLOR });
      activePointer = null;
      chainStep = 0;
    }

    lastIndex = match.index + full.length;
  }

  if (lastIndex < input.length) {
    tokens.push({ text: input.slice(lastIndex), color: DEFAULT_COLOR });
  }

  return tokens;
}
