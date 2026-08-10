// components/builder/JsonOutputPane.tsx
import React, { useState, useEffect, useRef } from 'react';
import { useBuilderStore } from '../../store/useBuilderStore';
import { DataLoader } from '../../utils/DataLoader';
import { BuilderUtils } from '../../utils/BuilderUtils';

export const JsonOutputPane: React.FC = () => {
  const { activeChar, baseStats, mechanics, resetCache, highlightedNodeId } = useBuilderStore();
  const codeEditorRef = useRef<HTMLPreElement>(null);
  const isWeapon = activeChar ? !!DataLoader.weaponDB[activeChar] : false;

  // 1. Local state for formatted JSON output
  const [formatted, setFormatted] = useState(() =>
    BuilderUtils.formatJSONOutput(activeChar, baseStats, mechanics, isWeapon)
  );

  // 2. 250ms Debounce effect for JSON stringification and syntax highlighting
  useEffect(() => {
    const timer = setTimeout(() => {
      setFormatted(BuilderUtils.formatJSONOutput(activeChar, baseStats, mechanics, isWeapon));
    }, 50);

    return () => clearTimeout(timer);
  }, [activeChar, baseStats, mechanics, isWeapon]);

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
          currentLine.style.backgroundColor = 'rgba(212, 175, 55, 0.25)';
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
    <div className="output-pane">
      <div className="panel-header-tiny flex-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Outputs</span>
        <div className="flex-row gap-sm" style={{ width: 'auto' }}>
          <button
            id="reset-builder-cache-btn"
            className="base-btn text-xs btn-danger"
            onClick={handleResetCache}
            disabled={!activeChar}
          >
            Reset Cache
          </button>
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
      </div>
      <pre
        ref={codeEditorRef}
        id="json-output"
        className="code-editor"
        dangerouslySetInnerHTML={{ __html: formatted.highlightedHTML }}
      />
    </div>
  );
};