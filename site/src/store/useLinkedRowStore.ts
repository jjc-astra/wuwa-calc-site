import { create } from 'zustand';

const NONE: string[] = [];

export interface LinkedRowState {
  // Hovered row ids; the first is scrolled to.
  rowIds: string[];
  source: 'table' | 'timeline' | null;
  scroll: boolean;
  hover: (rowIds: string[], source: 'table' | 'timeline', scroll?: boolean) => void;
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** Links hover highlights between the rotation table and the Timeline. */
export const useLinkedRowStore = create<LinkedRowState>()(set => ({
  rowIds: NONE,
  source: null,
  scroll: true,
  hover: (rowIds, source, scroll = true) => set(state => (
    state.source === source && state.scroll === scroll && sameIds(state.rowIds, rowIds)
      ? state
      : { rowIds: rowIds.length ? rowIds : NONE, source, scroll }
  ))
}));

// Scroll throttle.
const SCROLL_INTERVAL_MS = 150;

/** Throttled scroll-to-row subscription. Returns the unsubscribe. */
export function subscribeLinkedScroll(target: (s: LinkedRowState) => string | undefined, scrollTo: (id: string) => void): () => void {
  let timer = 0;
  let lastAt = -Infinity;
  let pending: string | undefined;
  const unsubscribe = useLinkedRowStore.subscribe((s, prev) => {
    const id = target(s);
    if (id === target(prev)) return;
    pending = id;
    if (!id || timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      lastAt = performance.now();
      if (pending) scrollTo(pending);
    }, Math.max(0, lastAt + SCROLL_INTERVAL_MS - performance.now()));
  });
  return () => { clearTimeout(timer); unsubscribe(); };
}

/** Minimally scrolls `el` into view within `container` only. `insetLeft`: sticky column width. */
export function scrollIntoContainer(el: HTMLElement, container: HTMLElement | null, { margin = 8, insetLeft = 0 } = {}): void {
  if (!container) return;
  const box = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const delta = (start: number, end: number, boxStart: number, boxEnd: number) => {
    if (end - start > boxEnd - boxStart - margin * 2 || start < boxStart + margin) return start - boxStart - margin;
    if (end > boxEnd - margin) return end - boxEnd + margin;
    return 0;
  };
  const top = delta(r.top, r.bottom, box.top, box.bottom);
  const left = delta(r.left, r.right, box.left + insetLeft, box.right);
  if (top || left) container.scrollBy({ top, left, behavior: 'smooth' });
}
