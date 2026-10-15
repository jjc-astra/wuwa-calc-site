export type DSLDataType = 'number' | 'string' | 'string[]' | 'boolean' | 'method';

export interface DSLPropertyDef {
  propName: string;
  type: DSLDataType;
  /** Suffix after targetVar (e.g. '.hp'). */
  targetKey?: string;
  /** Exact substitution, replacing targetVar + targetKey. */
  fullOverride?: string;
  /** Regex in place of propName (e.g. 'CastTypes?'). */
  regexPattern?: string;
  isMethod?: boolean;
  /** Methods: the compiled function name. */
  jsName?: string;
  tooltip?: string;
}

export interface DSLPointerDef {
  pointer: string;
  /** What bare '@Pointer' compiles to. */
  targetVar?: string;
  /** '@System(Name)' form. */
  usesCallSyntax?: boolean;
  tooltip: string;
  properties: DSLPropertyDef[];
}

export interface SuggestionItem {
  val: string;
  group: string;
  prefix?: string;
  append?: string;
  /** Tooltip key when it differs from `val`. */
  tooltipKey?: string;
  /** Owning pointer, for properties. */
  pointer?: string;
  /** Display text, if different from `val`. */
  label?: string;
}

export interface MatchRule {
  trigger: RegExp;
  matchGroup?: number;
  options: SuggestionItem[] | ((match: RegExpMatchArray) => SuggestionItem[]);
  prefix?: string;
  append?: string;
  dynamicAppend?: (val: string) => string | null;
  commaList?: boolean;
  /** Closing bracket offered after an entry. */
  commaCloses?: string;
}
