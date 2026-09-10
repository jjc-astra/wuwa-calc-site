import React, { useState, useEffect, useRef } from 'react';
import { useBuilderStore, mechFolderFor } from '../../store/useBuilderStore';
import { DataLoader } from '../../utils/DataLoader';
import { BuilderUtils } from '../../utils/BuilderUtils';
import { ConfirmDialog } from '../common/ConfirmDialog';

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
  const { activeChar, activeFolder, baseStats, mechanics, resetCache, highlightedNodeId, hoveredFieldHighlight, hasChanges } = useBuilderStore();
  const codeEditorRef = useRef<HTMLPreElement>(null);
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

  const handleCopy = (text: string, buttonId: string, label: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById(buttonId);
      if (btn) {
        btn.innerText = 'Copied!';
        setTimeout(() => (btn.innerText = label), 2000);
      }
    }).catch(() => {
      alert('Failed to copy to clipboard.');
    });
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
          <button
            id="copy-char-btn"
            className="base-btn text-xs"
            onClick={() => handleCopy(formatted.charJsonString, 'copy-char-btn', 'Copy Character JSON')}
            disabled={!formatted.charJsonString}
          >
            Copy Character JSON
          </button>
          <button
            id="copy-mech-btn"
            className="base-btn text-xs"
            onClick={() => handleCopy(formatted.mechJsonString, 'copy-mech-btn', 'Copy Mechanics JSON')}
            disabled={!formatted.mechJsonString}
          >
            Copy Mechanics JSON
          </button>
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
