import type { MouseEvent } from 'react';
import { SIM_CONSTANTS, type ImageFolder } from '../data/db';
import { toFrames, framesToSeconds } from './Frames';
import { imageUrl, dataUrl } from './dataSource';
import type { ElementName } from '../data/gameVocab';
import { SYSTEM_NAMESPACE } from './MechanicKey';

/** Current UI scale (root font-size / 16). */
export const uiScale = (): number =>
  parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1;

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

/** Element color for a dmg/status tag ("Glacio", "Glacio Chafe"). */
export const elementColorOf = (tag: string): string | undefined =>
  ELEMENT_COLORS[tag] ?? ELEMENT_COLORS[Object.keys(ELEMENT_COLORS).find(el => tag.includes(el)) ?? ''];

/** Character color, falling back to element color, then gray. */
export function getCharacterThemeColor(dbChar: Record<string, any> | undefined): string {
  if (!dbChar) return '#555555';
  return dbChar.themeColor || dbChar.color || ELEMENT_COLORS[dbChar.element] || '#555555';
}

type TooltipSize = { width: number; height: number };
type TooltipPlacement = (size: TooltipSize) => { left: number; top: number };

/** The app's shared hover tooltip: one viewport-aware node, positioned by transform. */
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

  /** Like show(), anchored to cursor coords. */
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

/** "3", "1.25" */
export const formatNum = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export const escapeHtml = (text: unknown): string =>
  String(text ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** One "Key: value" tooltip line. */
export const tooltipLine = (key: string, value: unknown): string =>
  `<div><span class="tooltip-key">${key}:</span> <span class="tooltip-val">${escapeHtml(value).replace(/→/g, '<span class="tooltip-arrow">→</span>')}</span></div>`;

/** Spread onto an element in place of `title`. */
export const tip = (text: string) => ({
  onMouseEnter: (e: MouseEvent) => TooltipManager.show(e.currentTarget as Element, text),
  onMouseLeave: () => TooltipManager.hide()
});

export const CommonUtils = {
  /** NaN reads as min. */
  clampToRange: (val: number, min: number, max: number): number => {
    if (isNaN(val)) return min;
    return Math.min(max, Math.max(min, val));
  },

  /** Icon URL; a transparent pixel for no name. */
  getIconPath: (name: string, folder: ImageFolder): string => {
    if (!name) return TRANSPARENT_PIXEL;
    // System's icon is filed as Generic.
    const n = name.startsWith('Rover') ? 'Rover' : name === SYSTEM_NAMESPACE ? 'Generic' : name;
    return CommonUtils.getImage(`${folder}/Icon_${n.replaceAll(' ', '')}${EXTENSION}`);
  },

  // True if `src` is already cached (skips the fade-in).
  isImageCached: (src: string): boolean => {
    if (!src) return false;
    const img = new Image();
    img.src = src;
    return img.complete;
  },

  // Hold cursor position for pingpong/loop/clamp.
  resolveHoldCursor: (progress: number, mode: string, maxVal: number): number => {
    if (mode === 'clamp') return Math.max(0, Math.min(progress, maxVal));
    if (mode === 'loop') return ((progress % maxVal) + maxVal) % maxVal;
    const doubleMax = maxVal * 2;
    const wrapped = ((progress % doubleMax) + doubleMax) % doubleMax;
    return wrapped > maxVal ? doubleMax - wrapped : wrapped;
  },

  // Hold cursor position after `holdDurationFrames`.
  resolveHoldCursorAtTime: (accumulated: number, holdDurationFrames: number, speed: number, mode: string, maxVal: number): number => {
    const progress = accumulated + framesToSeconds(toFrames(holdDurationFrames)) * speed;
    return CommonUtils.resolveHoldCursor(progress, mode, maxVal);
  },

  // True when the cursor is in the window (clamp: full or empty).
  isHoldCursorDone: (cursor: number, hold: { mode: string; speed: number; maxVal: number; center: number; size: number }): boolean =>
    hold.mode === 'clamp'
      ? (hold.speed >= 0 ? cursor >= hold.maxVal : cursor <= 0)
      : Math.abs(cursor - hold.center) <= hold.size / 2,

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

  // True for a per-rank list ("8/10/12/14/16"), not DSL math.
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

  /** "Name-WI-S#" filename fragments per team slot. */
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

  /** Strips float noise (1.4700000001 -> 1.47). */
  trimNumber: (value: number, digits = 3): number => (Number.isInteger(value) ? value : parseFloat(value.toFixed(digits))),

  /** e.g. "Rotation_Lumi-RC_Sanhua.json". */
  exportFilename: (prefix: string, team: Array<{ character?: string; weapon?: string; sequence?: number }>, suffix = ''): string => {
    const names = CommonUtils.buildTeamIds(team);
    return `${prefix}_${names.length > 0 ? names.join('_') : 'Config'}${suffix}.json`;
  },

  readTextFile: (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    }),

  /** Downloads `data` as pretty-printed JSON. */
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
   * Parses multipliers ("150%", "[50%, 100%]", "120").
   * Keeps '%': it separates scaling mults from flat ones.
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