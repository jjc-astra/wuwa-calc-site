// components/builder/JsonOutputPane.tsx
import React, { useState, useEffect, useRef } from 'react';
import { useBuilderStore, mechFolderFor } from '../../store/useBuilderStore';
import { DataLoader } from '../../utils/DataLoader';
import { BuilderUtils } from '../../utils/BuilderUtils';
import { ConfirmDialog } from '../common/ConfirmDialog';

// Applies (or clears, if nodeId is null) the whole-node hover highlight. scroll=true only for
// a genuine highlightedNodeId change (see the effect below) -- the self-healing re-apply after
// an incidental content replacement must never move the view out from under the user.
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
      // Land the highlighted node at the top of the visible area (with a small margin so it
      // isn't flush against the edge) rather than centered -- centering pushed the node's own
      // start line up out of easy view whenever the block itself was taller than half the
      // panel, which is common for a node with a full effects array.
      const outBoxRect = outBox.getBoundingClientRect();
      const lineRect = startLine.getBoundingClientRect();
      outBox.scrollTo({ top: outBox.scrollTop + (lineRect.top - outBoxRect.top) - 12, behavior: 'auto' });
    }
    break;
  }
}

// Applies (or clears) the field-level highlight for a now-open sub-panel's edited fields.
// Gated on highlight.nodeId matching hoveredId -- i.e. only shows while the mouse is actually
// over that node's row or its open panel (see MechanicNodeCard's handlePanelAreaMouseEnter/
// Leave), not for the entire time the panel happens to be open. Never scrolls.
function applyFieldHighlight(
  outBox: HTMLElement,
  highlight: { nodeId: string; fields: string[] } | null,
  hoveredId: string | null
): void {
  outBox.querySelectorAll('.code-field-highlighted').forEach(el => el.classList.remove('code-field-highlighted'));
  if (!highlight || highlight.nodeId !== hoveredId) return;
  const { nodeId, fields } = highlight;

  const keys = outBox.querySelectorAll('.syntax-key');
  const nodeKeySpan = Array.from(keys).find(k => (k as HTMLElement).innerText.includes(`"${nodeId}":`)) as HTMLElement | undefined;
  if (!nodeKeySpan) return;
  const nodeStartLine = nodeKeySpan.closest('.code-line') as HTMLElement | null;
  if (!nodeStartLine) return;

  // Collect the node's own lines first so a field-name search below can't cross into a
  // different node that happens to share a field name (e.g. every node has "name").
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

    // A scalar value (e.g. "name": "Basic Attack 1") has no bracket on its own line, so this
    // highlights just that one line; an object/array value (e.g. "effects": [) walks forward
    // through its full block the same way applyNodeHighlight walks a whole node.
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
  const { activeChar, activeFolder, baseStats, mechanics, resetCache, highlightedNodeId, activePanelHighlight, hoveredPanelNodeId, hasChanges } = useBuilderStore();
  const codeEditorRef = useRef<HTMLPreElement>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const isWeapon = activeChar ? !!DataLoader.weaponDB[activeChar] : false;
  const isDirty = activeChar ? hasChanges(activeChar) : false;
  // Same folder DataLoader.loadMechanic/clearMechanicCache actually use -- 'characters',
  // 'weapons', 'sets', 'echoes', or 'generic' -- so the "Save this exact JSON to" comment names
  // the real path instead of a literal, never-substituted "[folder]" placeholder.
  const mechFolder = mechFolderFor(activeFolder);

  // 1. Local state for formatted JSON output
  const [formatted, setFormatted] = useState(() =>
    BuilderUtils.formatJSONOutput(activeChar, baseStats, mechanics, isWeapon, mechFolder)
  );

  // 2. 250ms Debounce effect for JSON stringification and syntax highlighting
  useEffect(() => {
    const timer = setTimeout(() => {
      setFormatted(BuilderUtils.formatJSONOutput(activeChar, baseStats, mechanics, isWeapon, mechFolder));
    }, 50);

    return () => clearTimeout(timer);
  }, [activeChar, baseStats, mechanics, isWeapon, mechFolder]);

  // 3. Highlight full node block on hover (scrolls -- this only runs on a genuine
  // highlightedNodeId/content change, not on every incidental re-render).
  useEffect(() => {
    const outBox = codeEditorRef.current;
    if (!outBox) return;
    applyNodeHighlight(outBox, highlightedNodeId, true);
  }, [highlightedNodeId, formatted.highlightedHTML]);

  // 4. Highlight the specific fields a now-open sub-panel edits -- a stronger overlay on top of
  // the whole-node hover highlight above, so clicking a cell (e.g. Timing Mods) shows exactly
  // which lines it touches instead of leaving the reader to hunt through the node's full JSON.
  useEffect(() => {
    const outBox = codeEditorRef.current;
    if (!outBox) return;
    applyFieldHighlight(outBox, activePanelHighlight, hoveredPanelNodeId);
  }, [activePanelHighlight, hoveredPanelNodeId, formatted.highlightedHTML]);

  // 5. Self-healing re-apply: the two effects above only fire when their own dependencies
  // change, but formatJSONOutput/setFormatted can also fire on its own 50ms debounce slightly
  // out of step with a hover-driven highlight -- dangerouslySetInnerHTML then swaps in a fresh
  // set of .code-line elements, silently discarding whatever classes were just added to the old
  // ones. Watching the actual DOM for that replacement and re-applying both highlights (without
  // scrolling) makes them resilient to that race regardless of why the content changed.
  const highlightStateRef = useRef({ highlightedNodeId, activePanelHighlight, hoveredPanelNodeId });
  useEffect(() => {
    highlightStateRef.current = { highlightedNodeId, activePanelHighlight, hoveredPanelNodeId };
  }, [highlightedNodeId, activePanelHighlight, hoveredPanelNodeId]);

  useEffect(() => {
    const outBox = codeEditorRef.current;
    if (!outBox) return;
    const observer = new MutationObserver(muts => {
      const contentReplaced = muts.some(m => m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0));
      if (!contentReplaced) return;
      const { highlightedNodeId: hn, activePanelHighlight: aph, hoveredPanelNodeId: hp } = highlightStateRef.current;
      applyNodeHighlight(outBox, hn, false);
      applyFieldHighlight(outBox, aph, hp);
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
