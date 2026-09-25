import { createContext } from 'react';

/** Node classes used by the About diagrams, in legend order. Colors may be palette vars. */
export const NODE_KINDS = [
  { id: 'ui', label: 'UI component / hook', fill: 'var(--bg-card)', stroke: 'var(--border)', color: 'var(--text-main)' },
  { id: 'store', label: 'Zustand store', fill: '#3b3221', stroke: 'var(--accent)', color: 'var(--accent-light)' },
  { id: 'logic', label: 'Logic (pure simulation, math)', fill: '#203024', stroke: 'var(--success)', color: 'var(--text-main)' },
  { id: 'worker', label: 'Worker thread', fill: 'var(--bg-panel)', stroke: 'var(--warning)', color: 'var(--text-main)', dash: '4 3' },
  { id: 'data', label: 'Data / storage / external', fill: 'var(--bg-deep)', stroke: 'var(--text-dim)', color: 'var(--text-main)', dash: '2 3' },
  { id: 'alert', label: 'Stale / error path', fill: '#3a2222', stroke: 'var(--danger)', color: '#ffdddd' }
];

/** Per-section "Actual size" toggle: natural size with scrolling instead of fit to width. */
export const ActualSizeContext = createContext(false);

// Mermaid needs literal colors, so palette vars are read off :root.
const resolveColor = (value: string): string => {
  const match = /^var\((--[\w-]+)\)$/.exec(value);
  return match ? getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim() : value;
};

// Loaded on first use, so mermaid stays out of the main bundle.
let mermaidReady: Promise<{ mermaid: typeof import('mermaid').default; classDefs: string }> | null = null;

/** Mermaid, initialized with the site palette, plus classDef lines for NODE_KINDS. */
export const loadMermaid = () => {
  mermaidReady ??= import('mermaid').then(({ default: mermaid }) => {
    const c = resolveColor;
    mermaid.initialize({
      startOnLoad: false,
      // Labels break only at their own <br/>s; mermaid 11 wraps them at 200px otherwise.
      markdownAutoWrap: false,
      theme: 'base',
      themeVariables: {
        fontFamily: 'sans-serif',
        fontSize: '14px',
        background: c('var(--bg-well)'),
        primaryColor: c('var(--bg-card)'),
        primaryTextColor: c('var(--text-main)'),
        primaryBorderColor: c('var(--border)'),
        secondaryColor: c('var(--bg-panel)'),
        tertiaryColor: c('var(--bg-well)'),
        lineColor: c('var(--text-dim)'),
        textColor: c('var(--text-main)'),
        mainBkg: c('var(--bg-card)'),
        nodeBorder: c('var(--border)'),
        clusterBkg: c('var(--bg-well)'),
        clusterBorder: c('var(--border)'),
        titleColor: c('var(--accent)'),
        edgeLabelBackground: c('var(--bg-dark)')
      },
      flowchart: { wrappingWidth: 2000, subGraphTitleMargin: { top: 6, bottom: 14 }, useMaxWidth: true, htmlLabels: true, curve: 'basis', nodeSpacing: 24, rankSpacing: 32, diagramPadding: 8 }
    });
    const classDefs = NODE_KINDS.map(k => {
      const dash = k.dash ? `,stroke-dasharray:${k.dash}` : '';
      return `classDef ${k.id} fill:${c(k.fill)},stroke:${c(k.stroke)},color:${c(k.color)}${dash};`;
    }).join('\n');
    return { mermaid, classDefs };
  });
  return mermaidReady;
};
