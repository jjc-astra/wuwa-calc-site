// Lightweight tokenizer for the mechanics DSL -- drives the syntax-highlight overlay behind
// DSL input fields (AutocompleteInput). Purely cosmetic: never feeds DSLParser, so a
// misclassified token can't break a rule.

export interface DSLToken {
  text: string;
  color: string;
}

const BRACKET_COLORS = ['#ffd700', '#da70d6', '#00bfff', '#7fd88f', '#ff7f50'];

const KEYWORD_COLOR = '#c678dd';
const EVENT_COLOR = '#dca54c';
const POINTER_COLOR = '#61afef';
const PROPERTY_COLOR = '#56b6c2';
const NUMBER_COLOR = '#98c379';
const OPERATOR_COLOR = '#9aa0a8';
const DEFAULT_COLOR = 'var(--text-main)';

// Capture groups, in priority order: pointer, property, keyword, event, operator, bracket, number
const TOKEN_REGEX =
  /(@[A-Za-z_][A-Za-z0-9_]*)|(\.[A-Za-z_][A-Za-z0-9_]*)|(\b(?:IF|AND|OR|NOT|ANY|ALL|XOR|ALWAYS|MATH|ABS)\b)|(\b(?:On|After|Detonate)[A-Za-z]*\b)|(&&|\|\||==|!=|>=|<=|\.\.|[<>+\-*/%])|([()[\]])|(-?\d+(?:\.\d+)?%?)/gi;

export function tokenizeDSL(input: string): DSLToken[] {
  if (!input) return [];

  const tokens: DSLToken[] = [];
  let lastIndex = 0;
  let depth = 0;

  TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_REGEX.exec(input)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: input.slice(lastIndex, match.index), color: DEFAULT_COLOR });
    }

    const [full, pointer, property, keyword, event, operator, bracket, number] = match;

    if (pointer) {
      tokens.push({ text: full, color: POINTER_COLOR });
    } else if (property) {
      tokens.push({ text: full, color: PROPERTY_COLOR });
    } else if (keyword) {
      tokens.push({ text: full, color: KEYWORD_COLOR });
    } else if (event) {
      tokens.push({ text: full, color: EVENT_COLOR });
    } else if (operator) {
      tokens.push({ text: full, color: OPERATOR_COLOR });
    } else if (bracket) {
      if (bracket === '(' || bracket === '[') {
        tokens.push({ text: full, color: BRACKET_COLORS[depth % BRACKET_COLORS.length] });
        depth++;
      } else {
        depth = Math.max(0, depth - 1);
        tokens.push({ text: full, color: BRACKET_COLORS[depth % BRACKET_COLORS.length] });
      }
    } else if (number) {
      tokens.push({ text: full, color: NUMBER_COLOR });
    }

    lastIndex = match.index + full.length;
  }

  if (lastIndex < input.length) {
    tokens.push({ text: input.slice(lastIndex), color: DEFAULT_COLOR });
  }

  return tokens;
}
