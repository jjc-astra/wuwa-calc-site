import { create } from 'zustand';

const NONE: string[] = [];

interface LinkedRowState {
  // The rotation rows (by row id) under the cursor in the table, or tied to what's under it on the
  // Calculator Timeline (a move's row, or the rows a buff reached). The first is scrolled to.
  rowIds: string[];
  // Where the hover is, so only the other view scrolls.
  source: 'table' | 'timeline' | null;
  // Whether the other view scrolls to the first row (a move: yes; a buff's rows: no).
  scroll: boolean;
  hover: (rowIds: string[], source: 'table' | 'timeline', scroll?: boolean) => void;
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** Links the rotation table and the Calculator Timeline: hovering a move in one highlights it in both. */
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

/**
 * Scrolls `el` into view inside its scroll container `container` only (never the page), by the least
 * amount. `insetLeft` is container width covered on the left (a sticky name column).
 */
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
