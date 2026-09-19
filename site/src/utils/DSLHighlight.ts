// Lightweight tokenizer for the mechanics DSL -- drives the syntax-highlight overlay behind
// DSL input fields (AutocompleteInput). Purely cosmetic: never feeds DSLParser, so a
// misclassified token can't break a rule.
import { DSL_POINTERS } from '../logic/dsl/dslRegistry';

export interface DSLToken {
  text: string;
  color: string;
  /** True for an @Pointer or .Property that doesn't match the DSL registry -- rendered with a wavy underline. */
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

// Self's Forte{N}/MaxForte{N} are synthesized dynamically elsewhere (see dslResolver.ts's
// makePropertyRule), never listed statically in the registry -- validated by shape instead.
const DYNAMIC_FORTE_PROPERTY = /^(Max)?Forte[0-9]+$/;

function isValidProperty(pointerName: string, propText: string, extraSelfProperties: string[]): boolean {
  if (pointerName === 'Self' && (DYNAMIC_FORTE_PROPERTY.test(propText) || extraSelfProperties.includes(propText))) return true;
  const pointer = DSL_POINTERS[pointerName];
  if (!pointer) return false;
  return pointer.properties.some(p => p.propName.replace(/\(\)$/, '') === propText);
}

// Capture groups, in priority order: pointer, property, keyword, event, operator, bracket, number
// The pointer alternative tries the "@Namespace(" shape first (namespace may carry spaces, e.g.
// echo names like "@Impermanence Heron(") -- only greedy up to a real "(", via lookahead, so it
// never swallows unrelated trailing words -- then falls back to a plain "@Word" pointer/property lead-in.
const TOKEN_REGEX =
  /(@[A-Za-z_][A-Za-z0-9_]*(?:\s[A-Za-z0-9_]+)*(?=\()|@[A-Za-z_][A-Za-z0-9_]*)|(\.[A-Za-z_][A-Za-z0-9_]*)|(\b(?:IF|AND|OR|NOT|ANY|ALL|XOR|ALWAYS|MATH|ABS)\b)|(\b(?:On|After)[A-Za-z]*\b)|(&&|\|\||==|!=|>=|<=|\.\.|[<>+\-*/%])|([()[\]])|(-?\d+(?:\.\d+)?%?)/gi;

// extraSelfProperties: per-character @Self properties (e.g. custom forte names) the static
// registry can't know about.
export function tokenizeDSL(input: string, extraSelfProperties: string[] = []): DSLToken[] {
  if (!input) return [];

  const tokens: DSLToken[] = [];
  let lastIndex = 0;
  let depth = 0;

  // Tracks whether we're immediately after "@Pointer" (chainStep 1, next .word validates as a
  // property) or after "@Pointer.Property" (chainStep 2+, further contiguous .words are native
  // JS method calls like .includes() -- not DSL properties, not validated).
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
        // Namespace call (@System(...), @CharacterName(...), @EchoName(...)) -- not a DSL
        // pointer lookup, and not this feature's concern (character/echo/move names, not schema).
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
        // Either a chained native method (.includes(), .length, ...) or a disconnected
        // ".word" with no preceding pointer -- neither is validated.
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
