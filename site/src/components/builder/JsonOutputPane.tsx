import React, { useState, useEffect, useRef } from 'react';
import { useBuilderStore, mechFolderFor, nodeIdPrefix } from '../../store/useBuilderStore';
import { DataLoader } from '../../utils/DataLoader';
import { BuilderUtils } from '../../utils/BuilderUtils';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ActionsMenuButton } from '../common/ActionsMenuButton';
import type { MechanicNode } from '../../types';

// Applies/clears the whole-node hover highlight.
// scroll=true only on real highlightedNodeId change; self-heal re-apply must never scroll.
function applyNodeHighlight(outBox: HTMLElement, nodeId: string | null, scroll: boolean): void {
  outBox.querySelectorAll('.code-highlighted').forEach(el => el.classList.remove('code-highlighted'));
  if (!nodeId) return;

  const keys = outBox.querySelectorAll('.syntax-key');
  for (const keySpan of Array.from(keys)) {
    const htmlSpan = keySpan as HTMLElement;
    if (!htmlSpan.innerText.includes(`"${nodeId}":`)) continue;
    const startLine = htmlSpan.closest('.code-line') as HTMLElement | null;
    if (!startLine) continue;

    let currentLine: HTMLElement | null = startLine;
    let depth = 0;
    while (currentLine) {
      currentLine.classList.add('code-highlighted');
      if (currentLine.innerText.includes('{')) depth++;
      if (currentLine.innerText.includes('}')) depth--;
      if (depth === 0) break;
      currentLine = currentLine.nextElementSibling as HTMLElement | null;
    }

    if (scroll) {
      // Aligns to top, not centered -- centering pushed a tall node's start line off-screen.
      const outBoxRect = outBox.getBoundingClientRect();
      const lineRect = startLine.getBoundingClientRect();
      outBox.scrollTo({ top: outBox.scrollTop + (lineRect.top - outBoxRect.top) - 12, behavior: 'auto' });
    }
    break;
  }
}

// Applies/clears field-level highlight for hovered sub-panel fields
// (see MechanicNodeCard's enter/leaveFieldHover). Never scrolls.
function applyFieldHighlight(
  outBox: HTMLElement,
  highlight: { nodeId: string; fields: string[] } | null
): void {
  outBox.querySelectorAll('.code-field-highlighted').forEach(el => el.classList.remove('code-field-highlighted'));
  if (!highlight) return;
  const { nodeId, fields } = highlight;

  const keys = outBox.querySelectorAll('.syntax-key');
  const nodeKeySpan = Array.from(keys).find(k => (k as HTMLElement).innerText.includes(`"${nodeId}":`)) as HTMLElement | undefined;
  if (!nodeKeySpan) return;
  const nodeStartLine = nodeKeySpan.closest('.code-line') as HTMLElement | null;
  if (!nodeStartLine) return;

  // Collect the node's own lines first, so field search can't cross into another
  // node with the same field name (e.g. every node has "name").
  const nodeLines: HTMLElement[] = [];
  let nodeCursor: HTMLElement | null = nodeStartLine;
  let nodeDepth = 0;
  while (nodeCursor) {
    nodeLines.push(nodeCursor);
    for (const ch of nodeCursor.innerText) {
      if (ch === '{') nodeDepth++;
      else if (ch === '}') nodeDepth--;
    }
    if (nodeDepth === 0) break;
    nodeCursor = nodeCursor.nextElementSibling as HTMLElement | null;
  }

  fields.forEach(fieldName => {
    const fieldKeySpan = nodeLines
      .flatMap(line => Array.from(line.querySelectorAll('.syntax-key')))
      .find(k => (k as HTMLElement).innerText.includes(`"${fieldName}":`)) as HTMLElement | undefined;
    if (!fieldKeySpan) return;
    const fieldStartLine = fieldKeySpan.closest('.code-line') as HTMLElement | null;
    if (!fieldStartLine) return;

    // Scalar value: highlights just this line. Object/array: walks its full block (like applyNodeHighlight).
    let fieldCursor: HTMLElement | null = fieldStartLine;
    let fieldDepth = 0;
    let opened = false;
    while (fieldCursor) {
      fieldCursor.classList.add('code-field-highlighted');
      for (const ch of fieldCursor.innerText) {
        if (ch === '{' || ch === '[') { fieldDepth++; opened = true; }
        else if (ch === '}' || ch === ']') fieldDepth--;
      }
      if (!opened || fieldDepth === 0) break;
      fieldCursor = fieldCursor.nextElementSibling as HTMLElement | null;
    }
  });
}

// Given a click point, finds how many characters into `sourceText` (the raw string that was
// fed to syntaxHighlight to produce `container`'s HTML) the click landed -- so entering edit
// mode can place the textarea's caret where the user actually clicked, instead of always at
// the start. caretPositionFromPoint (Firefox) / caretRangeFromPoint (Chrome/Safari) both report
// a DOM text node + offset for the click.
//
// Can't just walk every text node in `container` and sum lengths: syntaxHighlight renders each
// source line as its own block-level `.code-line` div and joins them with '' (line breaks come
// from those being display:block, not from a literal '\n' anywhere in the HTML) -- summing DOM
// text lengths directly silently drops one character per preceding line, landing the caret on
// the right row but drifting further off within it the further down the click was. Instead:
// find which .code-line was clicked and the offset within *that* line's own text nodes (DOM-
// accurate, and sidesteps syntaxHighlight substituting ' ' for a genuinely empty line), then
// add back real preceding lines' lengths (+1 per '\n') from `sourceText.split('\n')` itself.
function getFlatCaretOffset(container: HTMLElement, sourceText: string, x: number, y: number): number | null {
  const doc = document as any;
  let node: Node | null = null;
  let offset = 0;
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (!pos) return null;
    node = pos.offsetNode;
    offset = pos.offset;
  } else if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    if (!range) return null;
    node = range.startContainer;
    offset = range.startOffset;
  } else {
    return null;
  }
  if (!node || !container.contains(node)) return null;

  const lineEl = (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)?.closest('.code-line');
  if (!lineEl) return null;
  const lineIndex = Array.from(container.querySelectorAll('.code-line')).indexOf(lineEl);
  if (lineIndex === -1) return null;

  const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
  let withinLine = 0;
  let current = walker.nextNode();
  while (current) {
    if (current === node) { withinLine += offset; break; }
    withinLine += (current.textContent || '').length;
    current = walker.nextNode();
  }

  const sourceLines = sourceText.split('\n');
  let total = 0;
  for (let i = 0; i < lineIndex && i < sourceLines.length; i++) total += sourceLines[i].length + 1;
  const targetLineLen = sourceLines[lineIndex]?.length ?? 0;
  return total + Math.min(withinLine, targetLineLen);
}

interface EditableCodeBlockProps {
  className: string;
  highlightedHTML: string;
  visualText: string;
  isEditing: boolean;
  draft: string;
  draftHighlightedHTML: string;
  error: string | null;
  caretOffset: number | null;
  onStartEdit: (clickOffset: number | null) => void;
  onDraftChange: (text: string) => void;
  onBlur: () => void;
  preRef?: React.RefObject<HTMLPreElement | null>;
}

// Read-only view (syntax-highlighted <pre>) <-> edit view (transparent textarea layered over a
// backdrop <pre> that re-highlights the draft live) -- see builder.css's .code-editor-editing
// comment for how the two layers stay pixel-aligned.
const EditableCodeBlock: React.FC<EditableCodeBlockProps> = ({
  className, highlightedHTML, visualText, isEditing, draft, draftHighlightedHTML, error, caretOffset,
  onStartEdit, onDraftChange, onBlur, preRef
}) => {
  const backdropRef = useRef<HTMLPreElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The read-only <pre> and the edit-mode textarea are separate DOM elements swapped in and out
  // by isEditing -- a freshly-mounted one starts at scrollTop 0 with no memory of the other's
  // position, so it has to be carried across the swap by hand via this ref (survives across
  // isEditing's own re-renders since it belongs to this component instance, not either element).
  const readOnlyPreRef = useRef<HTMLPreElement>(null);
  const scrollPosRef = useRef({ top: 0, left: 0 });
  const setPreRef = (el: HTMLPreElement | null) => {
    readOnlyPreRef.current = el;
    if (preRef) (preRef as React.RefObject<HTMLPreElement | null>).current = el;
  };

  // Applies the click-computed caret position once the textarea mounts (autoFocus alone can't
  // place the cursor mid-text), then never again -- caretOffset is only meaningful at mount.
  // Also restores the scroll position captured from whichever element was showing just before.
  useEffect(() => {
    if (!isEditing) {
      if (readOnlyPreRef.current) {
        readOnlyPreRef.current.scrollTop = scrollPosRef.current.top;
        readOnlyPreRef.current.scrollLeft = scrollPosRef.current.left;
      }
      return;
    }
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const pos = caretOffset !== null ? Math.max(0, Math.min(draft.length, caretOffset)) : draft.length;
    el.setSelectionRange(pos, pos);
    el.scrollTop = scrollPosRef.current.top;
    el.scrollLeft = scrollPosRef.current.left;
    if (backdropRef.current) {
      backdropRef.current.scrollTop = scrollPosRef.current.top;
      backdropRef.current.scrollLeft = scrollPosRef.current.left;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  const syncScroll = () => {
    if (!textareaRef.current) return;
    scrollPosRef.current = { top: textareaRef.current.scrollTop, left: textareaRef.current.scrollLeft };
    if (backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') e.currentTarget.blur();
  };

  const handleBlur = () => {
    if (textareaRef.current) {
      scrollPosRef.current = { top: textareaRef.current.scrollTop, left: textareaRef.current.scrollLeft };
    }
    onBlur();
  };

  const handlePreScroll = (e: React.UIEvent<HTMLPreElement>) => {
    scrollPosRef.current = { top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft };
  };

  const handleClick = (e: React.MouseEvent<HTMLPreElement>) => {
    scrollPosRef.current = { top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft };
    onStartEdit(getFlatCaretOffset(e.currentTarget, visualText, e.clientX, e.clientY));
  };

  if (!isEditing) {
    return (
      <pre
        ref={setPreRef}
        className={className}
        onClick={handleClick}
        onScroll={handlePreScroll}
        dangerouslySetInnerHTML={{ __html: highlightedHTML }}
      />
    );
  }

  return (
    <div className={`${className} code-editor-editing ${error ? 'has-error' : ''}`}>
      <pre ref={backdropRef} className="code-edit-backdrop" dangerouslySetInnerHTML={{ __html: draftHighlightedHTML }} />
      <textarea
        ref={textareaRef}
        className="code-edit-input"
        value={draft}
        onChange={e => onDraftChange(e.target.value)}
        onScroll={syncScroll}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        spellCheck={false}
      />
    </div>
  );
};

export const JsonOutputPane: React.FC = () => {
  const {
    activeChar, activeFolder, baseStats, mechanics, resetCache, highlightedNodeId, hoveredFieldHighlight, hasChanges,
    setAllBaseStats, setMechanicNode, removeMechanicNode
  } = useBuilderStore();
  const codeEditorRef = useRef<HTMLPreElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  // Which menu item triggered the (shared) file picker -- read once the picker resolves.
  const pendingImportKind = useRef<'character' | 'mechanics' | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const isWeapon = activeChar ? !!DataLoader.weaponDB[activeChar] : false;
  const isDirty = activeChar ? hasChanges(activeChar) : false;
  // Must match the folder DataLoader.loadMechanic/clearMechanicCache use.
  const mechFolder = mechFolderFor(activeFolder);

  const [formatted, setFormatted] = useState(() =>
    BuilderUtils.formatJSONOutput(activeChar, baseStats, mechanics, isWeapon, mechFolder)
  );

  // Debounced JSON stringification and syntax highlighting.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFormatted(BuilderUtils.formatJSONOutput(activeChar, baseStats, mechanics, isWeapon, mechFolder));
    }, 50);

    return () => clearTimeout(timer);
  }, [activeChar, baseStats, mechanics, isWeapon, mechFolder]);

  // Body text kept byte-identical between the read-only view and the edit draft (comment line
  // + '\n' as a separate, known-length prefix) so a click's flat text offset can be mapped onto
  // the draft just by subtracting that prefix's length -- see EditableCodeBlock/getFlatCaretOffset.
  const charFolder = isWeapon ? 'weapons' : 'characters';
  const charCommentLine = `// Update this object in data/db_${charFolder}.json`;
  const charBody = formatted.charJsonString || '';
  const charVisual = !activeChar ? '' : charBody ? `${charCommentLine}\n${charBody}` : '// No base stats set yet -- click to add';
  const charPrefixLen = charBody ? charCommentLine.length + 1 : 0;
  const charHighlightedHTML = BuilderUtils.syntaxHighlight(charVisual);

  const mechCommentLine = `// Save this exact JSON to: data/${activeChar ? DataLoader.mechanicPath(mechFolder, activeChar) : ''}`;
  const mechBody = formatted.mechJsonString || '';
  const mechVisual = mechBody ? `${mechCommentLine}\n${mechBody}` : (charBody || !activeChar ? '// Add mechanic nodes to generate output!' : '');
  const mechPrefixLen = mechBody ? mechCommentLine.length + 1 : 0;
  const mechHighlightedHTML = BuilderUtils.syntaxHighlight(mechVisual);

  // Highlight full node block on hover (scrolls -- only on a genuine highlightedNodeId change).
  useEffect(() => {
    const outBox = codeEditorRef.current;
    if (!outBox) return;
    applyNodeHighlight(outBox, highlightedNodeId, true);
  }, [highlightedNodeId, mechHighlightedHTML]);

  // Highlight the specific fields currently hovered, on top of the whole-node highlight.
  useEffect(() => {
    const outBox = codeEditorRef.current;
    if (!outBox) return;
    applyFieldHighlight(outBox, hoveredFieldHighlight);
  }, [hoveredFieldHighlight, mechHighlightedHTML]);

  // Self-healing re-apply: dangerouslySetInnerHTML swaps in fresh .code-line elements
  // that drop highlight classes -- watches the DOM for that and reapplies without scrolling.
  const highlightStateRef = useRef({ highlightedNodeId, hoveredFieldHighlight });
  useEffect(() => {
    highlightStateRef.current = { highlightedNodeId, hoveredFieldHighlight };
  }, [highlightedNodeId, hoveredFieldHighlight]);

  useEffect(() => {
    const outBox = codeEditorRef.current;
    if (!outBox) return;
    const observer = new MutationObserver(muts => {
      const contentReplaced = muts.some(m => m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0));
      if (!contentReplaced) return;
      const { highlightedNodeId: hn, hoveredFieldHighlight: hfh } = highlightStateRef.current;
      applyNodeHighlight(outBox, hn, false);
      applyFieldHighlight(outBox, hfh);
    });
    observer.observe(outBox, { childList: true });
    return () => observer.disconnect();
  }, []);

  const downloadText = (text: string, filename: string) => {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCharacter = () => {
    if (!activeChar || !formatted.charJsonString) return alert('No character stats to export yet.');
    downloadText(JSON.stringify({ [activeChar]: baseStats }, null, 2), `${activeChar}_stats.json`);
  };

  const handleExportMechanics = () => {
    if (!activeChar || !formatted.mechJsonString) return alert('No mechanic nodes to export yet.');
    const filename = DataLoader.mechanicPath(mechFolder, activeChar).split('/').pop()!;
    downloadText(formatted.mechJsonString, filename);
  };

  // Tolerates a raw copy of the preview panel's own Character JSON line ('"Name": {...},'),
  // which isn't valid standalone JSON -- wraps it and drops the trailing comma before retrying.
  const parseImportedJson = (text: string): any => {
    try {
      return JSON.parse(text);
    } catch {
      return JSON.parse(`{${text.trim().replace(/,\s*$/, '')}}`);
    }
  };

  const applyCharacterImport = (parsed: any) => {
    let stats = parsed;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (activeChar && Object.prototype.hasOwnProperty.call(parsed, activeChar)) {
        stats = parsed[activeChar];
      } else {
        const keys = Object.keys(parsed);
        if (keys.length === 1) stats = parsed[keys[0]];
      }
    }
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
      throw new Error('No character stats found in file.');
    }
    setAllBaseStats(stats);
  };

  const applyMechanicsImport = (parsed: Record<string, MechanicNode>) => {
    if (!activeChar || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('No mechanic nodes found in file.');
    }
    const prefix = nodeIdPrefix(activeChar);
    // Re-homes a node authored under a different provider (or with no prefix at all) onto the
    // entity currently open here, keeping whatever comes after the first underscore.
    const rekey = (key: string) => (key.startsWith(prefix) ? key : `${prefix}${key.includes('_') ? key.slice(key.indexOf('_') + 1) : key}`);

    const importedKeys = new Set<string>();
    Object.entries(parsed).forEach(([key, node]) => {
      const finalKey = rekey(key);
      importedKeys.add(finalKey);
      setMechanicNode(finalKey, node);
    });
    // Full replace, matching what loading a real file for this entity would look like --
    // drop whatever nodes existed before that the import doesn't carry forward.
    Object.keys(mechanics).forEach(key => {
      if (!importedKeys.has(key)) removeMechanicNode(key);
    });
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const kind = pendingImportKind.current;
    pendingImportKind.current = null;
    if (importInputRef.current) importInputRef.current.value = '';
    if (!file || !kind) return;

    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = parseImportedJson(ev.target?.result as string);
        if (kind === 'character') applyCharacterImport(parsed);
        else applyMechanicsImport(parsed);
      } catch (err) {
        alert(`Failed to import ${kind === 'character' ? 'character' : 'mechanics'} JSON: ${err instanceof Error ? err.message : 'invalid file.'}`);
      }
    };
    reader.readAsText(file);
  };

  const startImport = (kind: 'character' | 'mechanics') => {
    pendingImportKind.current = kind;
    importInputRef.current?.click();
  };

  const handleResetCacheConfirm = () => {
    resetCache();
    setResetConfirmOpen(false);
  };

  // --- Inline editing: click a block to swap it for a caret-editable textarea (layered over a
  // live-highlighted backdrop, see EditableCodeBlock) seeded with the same JSON, debounce-parse
  // as the user types, and apply successful parses straight through the same import path
  // Import JSON already uses. draft bodies match their read-only display byte-for-byte (see
  // charBody/mechBody above) so a click's flat offset maps onto the draft by subtracting the
  // comment-prefix length alone.
  const [charDraft, setCharDraft] = useState<string | null>(null);
  const [mechDraft, setMechDraft] = useState<string | null>(null);
  const [charError, setCharError] = useState<string | null>(null);
  const [mechError, setMechError] = useState<string | null>(null);
  const [charCaret, setCharCaret] = useState<number | null>(null);
  const [mechCaret, setMechCaret] = useState<number | null>(null);
  const charApplyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mechApplyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (charApplyTimer.current) clearTimeout(charApplyTimer.current);
    if (mechApplyTimer.current) clearTimeout(mechApplyTimer.current);
  }, []);

  const startCharEdit = (clickOffset: number | null) => {
    if (!activeChar) return;
    setCharError(null);
    const seed = charBody || JSON.stringify({ [activeChar]: {} }, null, 2);
    setCharDraft(seed);
    setCharCaret(charBody && clickOffset !== null ? clickOffset - charPrefixLen : null);
  };

  const commitCharDraft = (text: string) => {
    try {
      applyCharacterImport(parseImportedJson(text));
      setCharError(null);
    } catch (err) {
      setCharError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const handleCharDraftChange = (text: string) => {
    setCharDraft(text);
    if (charApplyTimer.current) clearTimeout(charApplyTimer.current);
    charApplyTimer.current = setTimeout(() => commitCharDraft(text), 500);
  };

  const handleCharBlur = () => {
    if (charApplyTimer.current) clearTimeout(charApplyTimer.current);
    if (charDraft !== null) commitCharDraft(charDraft);
    setCharDraft(null);
  };

  const startMechEdit = (clickOffset: number | null) => {
    if (!activeChar) return;
    setMechError(null);
    const seed = mechBody || '{}';
    setMechDraft(seed);
    setMechCaret(mechBody && clickOffset !== null ? clickOffset - mechPrefixLen : null);
  };

  const commitMechDraft = (text: string) => {
    try {
      applyMechanicsImport(parseImportedJson(text));
      setMechError(null);
    } catch (err) {
      setMechError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const handleMechDraftChange = (text: string) => {
    setMechDraft(text);
    if (mechApplyTimer.current) clearTimeout(mechApplyTimer.current);
    mechApplyTimer.current = setTimeout(() => commitMechDraft(text), 500);
  };

  const handleMechBlur = () => {
    if (mechApplyTimer.current) clearTimeout(mechApplyTimer.current);
    if (mechDraft !== null) commitMechDraft(mechDraft);
    setMechDraft(null);
  };

  // Re-highlighted live (no debounce -- syntaxHighlight is cheap on entity-sized JSON) so the
  // backdrop's coloring tracks every keystroke, not just what's already been applied.
  const charDraftHighlightedHTML = charDraft !== null ? BuilderUtils.syntaxHighlight(charDraft) : '';
  const mechDraftHighlightedHTML = mechDraft !== null ? BuilderUtils.syntaxHighlight(mechDraft) : '';

  return (
    <div className="output-pane-wrapper">
      <div className="panel-header-main">Outputs</div>
      <div className="output-pane">
      <div className="flex-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <div className="flex-row gap-sm" style={{ width: 'auto' }}>
          <input ref={importInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFileChange} />
          <ActionsMenuButton
            triggerClassName="base-btn text-xs"
            matchTriggerWidth
            triggerContent={<span>Import JSON</span>}
            items={[
              { key: 'char', label: 'Character JSON', onClick: () => startImport('character') },
              { key: 'mech', label: 'Mechanics JSON', onClick: () => startImport('mechanics') }
            ]}
          />
          <ActionsMenuButton
            triggerClassName="base-btn text-xs"
            matchTriggerWidth
            triggerContent={<span>Export JSON</span>}
            items={[
              { key: 'char', label: 'Character JSON', onClick: handleExportCharacter },
              { key: 'mech', label: 'Mechanics JSON', onClick: handleExportMechanics }
            ]}
          />
        </div>
        <div className="flex-row gap-sm" style={{ width: 'auto', alignItems: 'center' }}>
          {isDirty && (
            <span className="calc-warning-msg" style={{ display: 'flex' }}>
              <span>MECHANICS CHANGED</span>
              <svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
            </span>
          )}
          <button
            id="reset-builder-cache-btn"
            className="base-btn text-xs btn-danger"
            onClick={() => setResetConfirmOpen(true)}
            disabled={!activeChar}
          >
            Reset Cache
          </button>
        </div>
      </div>
      <div className="code-blocks">
        {activeChar && (
          <div className="code-block-section code-block-char">
            <EditableCodeBlock
              className="code-editor"
              highlightedHTML={charHighlightedHTML}
              visualText={charVisual}
              isEditing={charDraft !== null}
              draft={charDraft ?? ''}
              draftHighlightedHTML={charDraftHighlightedHTML}
              error={charError}
              caretOffset={charCaret}
              onStartEdit={startCharEdit}
              onDraftChange={handleCharDraftChange}
              onBlur={handleCharBlur}
            />
            {charError && <div className="code-error-msg">{charError}</div>}
          </div>
        )}
        <div className="code-block-section code-block-mech">
          <EditableCodeBlock
            className="code-editor"
            highlightedHTML={mechHighlightedHTML}
            visualText={mechVisual}
            isEditing={mechDraft !== null}
            draft={mechDraft ?? ''}
            draftHighlightedHTML={mechDraftHighlightedHTML}
            error={mechError}
            caretOffset={mechCaret}
            onStartEdit={startMechEdit}
            onDraftChange={handleMechDraftChange}
            onBlur={handleMechBlur}
            preRef={codeEditorRef}
          />
          {mechError && <div className="code-error-msg">{mechError}</div>}
        </div>
      </div>
      </div>
      {resetConfirmOpen && (
        <ConfirmDialog
          title="Reset builder cache?"
          message="All custom nodes and modifications will revert back to pristine database records."
          confirmLabel="Reset"
          onConfirm={handleResetCacheConfirm}
          onCancel={() => setResetConfirmOpen(false)}
        />
      )}
    </div>
  );
};
