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

  // Highlight full node block on hover (scrolls -- only on a genuine highlightedNodeId change).
  useEffect(() => {
    const outBox = codeEditorRef.current;
    if (!outBox) return;
    applyNodeHighlight(outBox, highlightedNodeId, true);
  }, [highlightedNodeId, formatted.highlightedHTML]);

  // Highlight the specific fields currently hovered, on top of the whole-node highlight.
  useEffect(() => {
    const outBox = codeEditorRef.current;
    if (!outBox) return;
    applyFieldHighlight(outBox, hoveredFieldHighlight);
  }, [hoveredFieldHighlight, formatted.highlightedHTML]);

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
      <pre
        ref={codeEditorRef}
        id="json-output"
        className="code-editor"
        dangerouslySetInnerHTML={{ __html: formatted.highlightedHTML }}
      />
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
