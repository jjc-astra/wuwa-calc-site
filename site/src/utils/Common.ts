import type { MouseEvent } from 'react';
import type { ImageFolder } from '../data/db';
import { toFrames, framesToSeconds } from './Frames';

export const EXTENSION = '.webp';
export const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

// Just a public GitHub owner/repo/branch -- not a secret, safe to hardcode. See getImage/getData.
export const DATA_REPO_BASE_URL = 'https://raw.githubusercontent.com/jjc-astra/wuwa-calc-data/main';

// Local dev-only mirror of the data repo's data/ and images/ folders (site/public/wip-data/),
// gitignored -- lets a unit's data/mechanics/images be tested against the live site before
// they're pushed to the real data repo. Dev builds check here first (see getData/getImage);
// never referenced in a prod build. main.tsx's WIP image-fallback listener and
// DataLoader.loadJSON's WIP fallback both fall back to DATA_REPO_BASE_URL when a path here 404s.
export const WIP_BASE_URL = '/wip-data';

export const ELEMENT_COLORS: Record<string, string> = {
  Glacio: '#40c4ff',
  Fusion: '#ff6b3b',
  Electro: '#b873f9',
  Aero: '#20e2a3',
  Spectro: '#ffe14d',
  Havoc: '#e056fd',
  Physical: '#aaaaaa'
};

/** A character's brand color, falling back through element color to a neutral gray. */
export function getCharacterThemeColor(dbChar: Record<string, any> | undefined): string {
  if (!dbChar) return '#555555';
  return dbChar.themeColor || dbChar.color || ELEMENT_COLORS[dbChar.element] || '#555555';
}

/**
 * Single shared, viewport-aware hover tooltip (mirrors the old site's TooltipManager).
 * One DOM node reused by every caller.
 */
class TooltipManagerClass {
  private el: HTMLDivElement | null = null;

  private ensureEl(): HTMLDivElement {
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'global-tooltip';
      document.body.appendChild(this.el);
    }
    return this.el;
  }

  show(target: Element, html: string | null): void {
    if (!html) return;
    const el = this.ensureEl();
    el.innerHTML = html;
    el.style.display = 'block';

    const rect = target.getBoundingClientRect();
    const tipRect = el.getBoundingClientRect();

    let top = rect.top - tipRect.height - 8;
    let left = rect.left + rect.width / 2 - tipRect.width / 2;

    if (top < 0) top = rect.bottom + 8;
    if (left < 10) left = 10;
    if (left + tipRect.width > window.innerWidth - 10) left = window.innerWidth - tipRect.width - 10;

    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }

  /** Like show(), but anchored to raw cursor coords -- for crosshair-style hover on a chart. */
  showAtPoint(x: number, y: number, html: string | null): void {
    if (!html) return;
    const el = this.ensureEl();
    el.innerHTML = html;
    el.style.display = 'block';

    const tipRect = el.getBoundingClientRect();
    let left = x + 16;
    let top = y - tipRect.height / 2;

    if (left + tipRect.width > window.innerWidth - 10) left = x - tipRect.width - 16;
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    if (top + tipRect.height > window.innerHeight - 10) top = window.innerHeight - tipRect.height - 10;

    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }

  hide(): void {
    if (this.el) this.el.style.display = 'none';
  }
}

export const TooltipManager = new TooltipManagerClass();

/** Spread onto an element instead of `title="..."` to use the shared TooltipManager. */
export const tip = (text: string) => ({
  onMouseEnter: (e: MouseEvent) => TooltipManager.show(e.currentTarget as Element, text),
  onMouseLeave: () => TooltipManager.hide()
});

export const CommonUtils = {
  debounce: <T extends (...args: any[]) => void>(func: T, delay: number): ((...args: Parameters<T>) => void) => {
    let timeout: ReturnType<typeof setTimeout>;
    return (...args: Parameters<T>) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), delay);
    };
  },

  createOptions: (list: string[], selectedValue: string | null, placeholderText = 'Select...'): string => {
    let html = `<option value="" disabled hidden ${!selectedValue ? 'selected' : ''}>${placeholderText}</option>`;
    list.forEach(item => {
      const isSelected = item === selectedValue ? 'selected' : '';
      html += `<option value="${item}" ${isSelected}>${item}</option>`;
    });
    return html;
  },

  enforceLimit: (input: HTMLInputElement, min: number, max: number): void => {
    const val = parseInt(input.value, 10);
    if (isNaN(val)) return;
    if (val > max) input.value = max.toString();
    if (val < min) input.value = min.toString();
  },

  /** React-friendly equivalent of enforceLimit for controlled numeric inputs. */
  clampToRange: (val: number, min: number, max: number): number => {
    if (isNaN(val)) return min;
    return Math.min(max, Math.max(min, val));
  },

  getIconPath: (name: string, folder: ImageFolder): string => {
    if (!name) return TRANSPARENT_PIXEL;
    const n = name.startsWith('Rover') ? 'Rover' : name;
    return CommonUtils.getImage(`${folder}/Icon_${n.replaceAll(' ', '')}${EXTENSION}`);
  },

  // True if `src` is already in the browser's image cache -- lets an icon that remounts (e.g.
  // switching pages) skip straight to its loaded state instead of replaying the fade-in.
  isImageCached: (src: string): boolean => {
    if (!src) return false;
    const img = new Image();
    img.src = src;
    return img.complete;
  },

  // Cursor position for a Hold's ping-pong/loop/clamp physics, given elapsed progress in cursor
  // units. Shared by TimelineEngine's auto-timing lookahead + live tracking and Gauge's display
  // so the three can't quietly diverge (they had -- Gauge's own copy skipped the wrap-to-positive
  // step for 'loop', and ignored negative progress for 'pingpong', unlike here).
  resolveHoldCursor: (progress: number, mode: string, maxVal: number): number => {
    if (mode === 'clamp') return Math.max(0, Math.min(progress, maxVal));
    if (mode === 'loop') return ((progress % maxVal) + maxVal) % maxVal;
    const doubleMax = maxVal * 2;
    const wrapped = ((progress % doubleMax) + doubleMax) % doubleMax;
    return wrapped > maxVal ? doubleMax - wrapped : wrapped;
  },

  // Cursor position `holdDurationFrames` after a hold started, given how much progress was
  // already `accumulated` (a retained cursor) and the hold's own cursorSpeed/mode/max. Wraps
  // resolveHoldCursor so its 3 call sites (TimelineEngine's lookahead search, its per-row live
  // tracking, and Gauge's display preview) don't each hand-roll the frames->seconds->progress
  // conversion -- that's what let 'loop' and 'pingpong' drift out of sync before this existed.
  resolveHoldCursorAtTime: (accumulated: number, holdDurationFrames: number, speed: number, mode: string, maxVal: number): number => {
    const progress = accumulated + framesToSeconds(toFrames(holdDurationFrames)) * speed;
    return CommonUtils.resolveHoldCursor(progress, mode, maxVal);
  },

  // Data/images live in the separate wuwa-calc-data repo (public, no auth) instead of this
  // repo's public/ folder -- new character data ships without rebuilding/redeploying the site.
  // raw.githubusercontent.com: CORS-enabled GETs, no api.github.com rate limit.
  // Dev builds resolve to the local WIP mirror first (see WIP_BASE_URL) -- a WIP-covered path
  // that 404s falls back to the real repo via DataLoader.loadJSON / main.tsx's img listener.
  getImage: (path: string): string => `${import.meta.env.DEV ? WIP_BASE_URL : DATA_REPO_BASE_URL}/images/${path}`,
  getData: (path: string): string => `${import.meta.env.DEV ? WIP_BASE_URL : DATA_REPO_BASE_URL}/data/${path}`,
  // Always the real data repo, bypassing WIP -- used for the fallback half of the WIP-first
  // lookup, and by loadMergedDB (a WIP copy of a combined DB file like db_characters.json must
  // be shallow-merged on top of the real one, never swap it wholesale, or every character/weapon
  // the WIP file omits would vanish from the dev site).
  getRealImage: (path: string): string => `${DATA_REPO_BASE_URL}/images/${path}`,
  getRealData: (path: string): string => `${DATA_REPO_BASE_URL}/data/${path}`,
  getWipData: (path: string): string => `${WIP_BASE_URL}/data/${path}`,

  parseMixed: (val: any): number | string | undefined => {
    if (val === undefined || val === null || val === '') return undefined;
    if (typeof val === 'number') return isNaN(val) ? undefined : val;
    const trimmed = String(val).trim();
    if (trimmed === '') return undefined;
    if (!isNaN(Number(trimmed))) return parseFloat(trimmed);
    return trimmed;
  },

  /**
   * Parses slash-delimited weapon/rank values (e.g. "12/15/18/21/24%") for a given rank (1-5).
   */
  parseRankValue: (val: any, rank = 1): any => {
    if (typeof val !== 'string' || !val.includes('/')) return val;
    const rankIdx = Math.max(0, Math.min(4, (parseInt(rank as any, 10) || 1) - 1));
    const parts = val.split('/');
    let resolved = parts[Math.min(rankIdx, parts.length - 1)].trim();
    if (val.includes('%') && !resolved.includes('%')) resolved += '%';
    return resolved;
  },

  /**
   * Builds "Name-WI-S#" id fragments for exported rotation/team filenames, one per team slot
   * with a character. Appends weapon initials (if set), then sequence (if above S0, since it
   * affects damage output) -- so exports of the same character/weapon stay distinguishable.
   */
  buildTeamIds: (team: Array<{ character?: string; weapon?: string; sequence?: number }>): string[] => {
    return team
      .filter(s => !!s.character)
      .map(s => {
        let id = String(s.character).replace(/\s+/g, '');
        if (s.weapon) {
          const initials = s.weapon.match(/\b\w/g) || [];
          id += `-${initials.join('').toUpperCase()}`;
        }
        if (s.sequence) id += `-S${s.sequence}`;
        return id;
      });
  },

  /** Triggers a browser download of `data` as a pretty-printed JSON file named `filename`. */
  downloadJson: (data: unknown, filename: string): void => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  /**
   * Parses multiplier strings ("150%", "[50%, 100%]", "120") into numbers/percent strings.
   * Keeps the '%' suffix ("N%") -- CombatCalculator.calculateDamageInstance uses it to tell a
   * scaling hit mult ("150%" -> pctMult) from a flat one ("120" -> flatMult, e.g. Tune Break).
   * Don't strip '%' here; that would silently turn percent mults into flat values.
   */
  parseMultiplierString: (raw: any): (number | string)[] | undefined => {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const str = String(raw).trim();
    const toVal = (s: string): number | string => {
      const trimmed = s.trim();
      const isPct = trimmed.includes('%');
      const num = parseFloat(trimmed.replace('%', ''));
      if (isNaN(num)) return 0;
      return isPct ? `${num}%` : num;
    };
    if (str.startsWith('[') && str.endsWith(']')) {
      try {
        const arr = JSON.parse(str.replace(/'/g, '"'));
        if (Array.isArray(arr)) {
          return arr.map(v => typeof v === 'number' ? v : toVal(String(v)));
        }
      } catch (e) { /* ignore JSON parse error */ }
    }
    if (str.includes(',')) {
      return str.split(',').map(toVal);
    }
    return isNaN(parseFloat(str.replace('%', ''))) ? undefined : [toVal(str)];
  }
};