import type { MouseEvent } from 'react';
import type { ImageFolder } from '../data/db';
import { toFrames, framesToSeconds } from './Frames';
import { imageUrl, dataUrl } from './dataSource';
import type { ElementName } from '../data/gameVocab';

/** Current UI scale (root font-size / 16) set by the fluid `html` rule in components.css --
 * turns a measured px size back into the 16px-rem "design units" the layout is written in. */
export const uiScale = (): number =>
  parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1;

/** Hex SHA-256 of a string. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export const EXTENSION = '.webp';
export const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

export const ELEMENT_COLORS: Record<string, string> = ({
  Glacio: '#40c4ff',
  Fusion: '#ff6b3b',
  Electro: '#b873f9',
  Aero: '#20e2a3',
  Spectro: '#ffe14d',
  Havoc: '#e056fd',
  Physical: '#aaaaaa'
} satisfies Record<ElementName, string>);

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
    // The data repo's icon for the 'System' entity is still filed under its old name, Generic.
    const n = name.startsWith('Rover') ? 'Rover' : name === 'System' ? 'Generic' : name;
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

  // Where data/images come from (data repo, or the dev WIP mirror first) is dataSource.ts's concern.
  getImage: imageUrl,
  getData: dataUrl,

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

  /** A number without float noise (1.4700000001 -> 1.47): whole numbers as they are, others rounded to `digits` places. */
  trimNumber: (value: number, digits = 3): number => (Number.isInteger(value) ? value : parseFloat(value.toFixed(digits))),

  /** "Rotation_Lumi-RC_Sanhua.json"-style name for exporting a team; "Rotation_Config.json" for an empty one. */
  exportFilename: (prefix: string, team: Array<{ character?: string; weapon?: string; sequence?: number }>, suffix = ''): string => {
    const names = CommonUtils.buildTeamIds(team);
    return `${prefix}_${names.length > 0 ? names.join('_') : 'Config'}${suffix}.json`;
  },

  /** The text of a file the user picked. */
  readTextFile: (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    }),

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