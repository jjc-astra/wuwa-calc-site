// components/builder/JsonOutputPane.tsx
import React, { useState, useEffect, useRef } from 'react';
import { useBuilderStore, mechFolderFor } from '../../store/useBuilderStore';
import { DataLoader } from '../../utils/DataLoader';
import { BuilderUtils } from '../../utils/BuilderUtils';

export const JsonOutputPane: React.FC = () => {
  const { activeChar, activeFolder, baseStats, mechanics, resetCache, highlightedNodeId, hasChanges } = useBuilderStore();
  const codeEditorRef = useRef<HTMLPreElement>(null);
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

  // 3. Highlight full node block on hover
  useEffect(() => {
    const outBox = codeEditorRef.current;
    if (!outBox) return;

    // Clear existing highlights
    outBox.querySelectorAll('.code-highlighted').forEach(el => {
      (el as HTMLElement).style.backgroundColor = '';
      el.classList.remove('code-highlighted');
    });

    if (!highlightedNodeId) return;

    // Search for the matching JSON key span
    const keys = outBox.querySelectorAll('.syntax-key');
    for (const keySpan of Array.from(keys)) {
      const htmlSpan = keySpan as HTMLElement;
      if (htmlSpan.innerText.includes(`"${highlightedNodeId}":`)) {
        const startLine = htmlSpan.closest('.code-line') as HTMLElement;
        if (!startLine) continue;

        let currentLine: HTMLElement | null = startLine;
        let depth = 0;

        while (currentLine) {
          currentLine.classList.add('code-highlighted');
          currentLine.style.backgroundColor = 'rgba(220, 165, 76, 0.25)';
          currentLine.style.transition = 'background-color 0.1s ease';

          if (currentLine.innerText.includes('{')) depth++;
          if (currentLine.innerText.includes('}')) depth--;

          if (depth === 0) break;
          currentLine = currentLine.nextElementSibling as HTMLElement | null;
        }

        const outBoxRect = outBox.getBoundingClientRect();
        const lineRect = startLine.getBoundingClientRect();
        const scrollTopTarget = outBox.scrollTop + (lineRect.top - outBoxRect.top) - (outBoxRect.height / 2) + (lineRect.height / 2);

        outBox.scrollTo({ top: scrollTopTarget, behavior: 'auto' });
        break;
      }
    }
  }, [highlightedNodeId, formatted.highlightedHTML]);

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

  const handleResetCache = () => {
    if (confirm('Reset current builder cache? All custom nodes and modifications will revert back to pristine database records.')) {
      resetCache();
    }
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
            onClick={handleResetCache}
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
    </div>
  );
};