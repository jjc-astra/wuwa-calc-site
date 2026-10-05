import type { MouseEvent } from 'react';
import { SIM_CONSTANTS, type ImageFolder } from '../data/db';
import { toFrames, framesToSeconds } from './Frames';
import { imageUrl, dataUrl } from './dataSource';
import type { ElementName } from '../data/gameVocab';
import { SYSTEM_NAMESPACE } from './MechanicKey';

/** Current UI scale (root font-size / 16) set by the fluid `html` rule in components.css --
 * turns a measured px size back into the 16px-rem "design units" the layout is written in. */
export const uiScale = (): number =>
  parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1;

/** Hex SHA-256 of a string. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

const EXTENSION = '.webp';
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

/** The color of the element a dmg/status tag names ("Glacio", "Glacio Chafe"), if any. */
export const elementColorOf = (tag: string): string | undefined =>
  ELEMENT_COLORS[tag] ?? ELEMENT_COLORS[Object.keys(ELEMENT_COLORS).find(el => tag.includes(el)) ?? ''];

/** A character's brand color, falling back through element color to a neutral gray. */
export function getCharacterThemeColor(dbChar: Record<string, any> | undefined): string {
  if (!dbChar) return '#555555';
  return dbChar.themeColor || dbChar.color || ELEMENT_COLORS[dbChar.element] || '#555555';
}

type TooltipSize = { width: number; height: number };
// Where the tooltip goes for a given size of it.
type TooltipPlacement = (size: TooltipSize) => { left: number; top: number };

/** The app's one hover tooltip: a single viewport-aware DOM node shared by every caller.
 * Hover moves stay cheap: content is written only when it changes, the size comes from a
 * ResizeObserver (after the browser's own layout) instead of a forced measure, and it's moved
 * with a transform, which needs no layout. */
class TooltipManagerClass {
  private el: HTMLDivElement | null = null;
  private html: string | null = null;
  private size: TooltipSize = { width: 0, height: 0 };
  private placement: TooltipPlacement | null = null;

  private ensureEl(): HTMLDivElement {
    if (!this.el) {
      const el = document.createElement('div');
      el.className = 'global-tooltip';
      document.body.appendChild(el);
      // A new size (new content, or shown again) re-places it before it paints.
      new ResizeObserver(([entry]) => {
        const box = entry.borderBoxSize?.[0];
        this.size = box ? { width: box.inlineSize, height: box.blockSize } : { width: el.offsetWidth, height: el.offsetHeight };
        this.place();
      }).observe(el);
      this.el = el;
    }
    return this.el;
  }

  private place(): void {
    if (!this.el || !this.placement || this.el.style.display !== 'block') return;
    const { left, top } = this.placement(this.size);
    this.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  private open(html: string, placement: TooltipPlacement): void {
    const el = this.ensureEl();
    if (html !== this.html) {
      el.innerHTML = html;
      this.html = html;
    }
    el.style.display = 'block';
    this.placement = placement;
    this.place();
  }

  show(target: Element, html: string | null): void {
    if (!html) return;
    const rect = target.getBoundingClientRect();
    this.open(html, ({ width, height }) => {
      let top = rect.top - height - 8;
      let left = rect.left + rect.width / 2 - width / 2;
      if (top < 0) top = rect.bottom + 8;
      if (left < 10) left = 10;
      if (left + width > window.innerWidth - 10) left = window.innerWidth - width - 10;
      return { left, top };
    });
  }

  /** Like show(), but anchored to raw cursor coords -- for crosshair-style hover on a chart. */
  showAtPoint(x: number, y: number, html: string | null): void {
    if (!html) return;
    this.open(html, ({ width, height }) => {
      let left = x + 16;
      let top = y - height / 2;
      if (left + width > window.innerWidth - 10) left = x - width - 16;
      if (left < 10) left = 10;
      if (top < 10) top = 10;
      if (top + height > window.innerHeight - 10) top = window.innerHeight - height - 10;
      return { left, top };
    });
  }

  hide(): void {
    if (this.el) this.el.style.display = 'none';
    this.placement = null;
  }
}

export const TooltipManager = new TooltipManagerClass();

/** A number for a label: whole as is, else to two places ("3", "1.25"). */
export const formatNum = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Text made safe to put in tooltip HTML. */
export const escapeHtml = (text: unknown): string =>
  String(text ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** One "Key: value" line of tooltip HTML (the value escaped). */
export const tooltipLine = (key: string, value: unknown): string =>
  `<div><span class="tooltip-key">${key}:</span> <span class="tooltip-val">${escapeHtml(value)}</span></div>`;

/** Spread onto an element instead of `title="..."` to use the shared TooltipManager. */
export const tip = (text: string) => ({
  onMouseEnter: (e: MouseEvent) => TooltipManager.show(e.currentTarget as Element, text),
  onMouseLeave: () => TooltipManager.hide()
});

export const CommonUtils = {
  /** `val` clamped to [min, max]; NaN reads as min. */
  clampToRange: (val: number, min: number, max: number): number => {
    if (isNaN(val)) return min;
    return Math.min(max, Math.max(min, val));
  },

  /** An entity's icon URL in `folder` (a transparent pixel for no name). */
  getIconPath: (name: string, folder: ImageFolder): string => {
    if (!name) return TRANSPARENT_PIXEL;
    // The data repo's icon for the 'System' entity is still filed under its old name, Generic.
    const n = name.startsWith('Rover') ? 'Rover' : name === SYSTEM_NAMESPACE ? 'Generic' : name;
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

  // Cursor position for a Hold's pingpong/loop/clamp physics, given elapsed progress in cursor
  // units. The one copy TimelineEngine and Gauge both use.
  resolveHoldCursor: (progress: number, mode: string, maxVal: number): number => {
    if (mode === 'clamp') return Math.max(0, Math.min(progress, maxVal));
    if (mode === 'loop') return ((progress % maxVal) + maxVal) % maxVal;
    const doubleMax = maxVal * 2;
    const wrapped = ((progress % doubleMax) + doubleMax) % doubleMax;
    return wrapped > maxVal ? doubleMax - wrapped : wrapped;
  },

  // Cursor position `holdDurationFrames` after a hold started, from progress already
  // `accumulated` (a retained cursor) and the hold's own cursorSpeed/mode/max.
  resolveHoldCursorAtTime: (accumulated: number, holdDurationFrames: number, speed: number, mode: string, maxVal: number): number => {
    const progress = accumulated + framesToSeconds(toFrames(holdDurationFrames)) * speed;
    return CommonUtils.resolveHoldCursor(progress, mode, maxVal);
  },

  // Whether a hold's cursor is where its release lands: in the window, or for 'clamp' (no
  // window) full when it fills (speed >= 0) or empty when it drains.
  isHoldCursorDone: (cursor: number, hold: { mode: string; speed: number; maxVal: number; center: number; size: number }): boolean =>
    hold.mode === 'clamp'
      ? (hold.speed >= 0 ? cursor >= hold.maxVal : cursor <= 0)
      : Math.abs(cursor - hold.center) <= hold.size / 2,

  // Where data/images come from (data repo, or the dev WIP mirror first) is dataSource.ts's concern.
  getImage: imageUrl,
  getData: dataUrl,

  /** A number if `val` reads as one, else its trimmed text; undefined when empty. */
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
  // True for a plain per-rank list ("8/10/12/14/16", "20%/25%/..."), as opposed to DSL math with a '/'.
  isRankValue: (val: unknown): val is string =>
    typeof val === 'string' && /^\s*-?[\d.]+%?(\s*\/\s*-?[\d.]+%?)+\s*$/.test(val),

  parseRankValue: (val: any, rank = 1): any => {
    if (typeof val !== 'string' || !val.includes('/')) return val;
    const rankIdx = Math.max(0, Math.min(SIM_CONSTANTS.MAX_RANK, parseInt(rank as any, 10) || 1) - 1);
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
      } catch { /* not JSON: parsed as a plain list below */ }
    }
    if (str.includes(',')) {
      return str.split(',').map(toVal);
    }
    return isNaN(parseFloat(str.replace('%', ''))) ? undefined : [toVal(str)];
  }
};