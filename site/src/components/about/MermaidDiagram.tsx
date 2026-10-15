import React, { useContext, useEffect, useId, useRef, useState } from 'react';
import { ActualSizeContext, loadMermaid } from './mermaidSetup';

// Fit mode:
// - scales up to MAX_UPSCALE
// - shrinks for height down to MIN_HEIGHT_SCALE
// - shrinks for width as needed
const MAX_UPSCALE = 1.3;
const MIN_HEIGHT_SCALE = 0.85;
// Header, note and padding, in px.
const HEIGHT_RESERVE = 130;

export const MermaidDiagram: React.FC<{ source: string }> = ({ source }) => {
  const actualSize = useContext(ActualSizeContext);
  const renderId = 'mmd-' + useId().replace(/[^\w]/g, '');
  const hostRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMermaid()
      .then(({ mermaid, classDefs }) => mermaid.render(renderId, `${source}\n${classDefs}`))
      .then(({ svg }) => {
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = svg;
        setRendered(true);
      })
      .catch(err => { if (!cancelled) setError(String(err?.message ?? err)); });
    return () => { cancelled = true; };
  }, [source, renderId]);

  useEffect(() => {
    const host = hostRef.current;
    const svg = host?.querySelector('svg');
    if (!rendered || !host || !svg) return;
    const { width, height } = svg.viewBox.baseVal;
    svg.style.maxWidth = 'none';
    svg.style.height = 'auto';
    if (actualSize) {
      svg.style.width = `${width}px`;
      return;
    }
    const view = host.closest('.about-scroll');
    const fit = () => {
      const byHeight = Math.max(((view?.clientHeight ?? Infinity) - HEIGHT_RESERVE) / height, MIN_HEIGHT_SCALE);
      const scale = Math.min(MAX_UPSCALE, byHeight, host.clientWidth / width);
      svg.style.width = `${width * scale}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    if (view) observer.observe(view);
    return () => observer.disconnect();
  }, [rendered, actualSize]);

  return (
    <div className="about-diagram">
      {!rendered && <div className="about-note">{error ?? 'Loading diagram...'}</div>}
      <div ref={hostRef} />
    </div>
  );
};
