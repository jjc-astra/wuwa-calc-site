export type DSLDataType = 'number' | 'string' | 'string[]' | 'boolean' | 'method';

export interface DSLPropertyDef {
  propName: string;
  type: DSLDataType;
  /** Generic parser target suffix (e.g. '.hp'), used as pointer.targetVar + targetKey. Omit when fullOverride is set. */
  targetKey?: string;
  /** Exact parser substitution for '@Pointer.PropName', for the cases targetVar+targetKey doesn't hold (see dslRegistry.ts). */
  fullOverride?: string;
  /** Regex fragment matched in place of propName, for variant spellings (e.g. 'CastTypes?', '(Unit|name)'). */
  regexPattern?: string;
  isMethod?: boolean;
  argsSignature?: string;
  tooltip?: string;
  /** Parser-only: contributes to translation but is excluded from autocomplete suggestions. */
  hidden?: boolean;
}

export interface DSLPointerDef {
  pointer: string;
  /** What bare '@Pointer' compiles to. Absent only for System, which is call-only. */
  targetVar?: string;
  /** True only for System: '@System(Name)' rather than '@System.Prop'. */
  usesCallSyntax?: boolean;
  tooltip: string;
  properties: DSLPropertyDef[];
}

export interface SuggestionItem {
  val: string;
  group: string;
  prefix?: string;
  append?: string;
  /** Lookup key into tooltip data when it differs from `val` (e.g. a pointer's trailing '.'/'(' stripped). */
  tooltipKey?: string;
  /** For the Properties group: which pointer (Self/Enemy/Move/...) this property belongs to. */
  pointer?: string;
  /** Display text, when it should differ from the text actually inserted (`val`). */
  label?: string;
}

export interface MatchRule {
  trigger: RegExp;
  matchGroup?: number;
  options: SuggestionItem[] | ((match: RegExpMatchArray) => SuggestionItem[]);
  prefix?: string;
  append?: string;
  dynamicAppend?: (val: string) => string | null;
  /** Marks a rule where multiple comma-separated values can be typed. */
  commaList?: boolean;
  /** Bracket-close char the "Continue" prompt offers too; omitted with no enclosing bracket (e.g. Applies During). */
  commaCloses?: string;
}
