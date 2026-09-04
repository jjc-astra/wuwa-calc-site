import type { MouseEvent } from 'react';
import type { ImageFolder } from '../data/db';

export const EXTENSION = '.webp';
export const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

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
 * One DOM node is reused for every caller instead of each element owning its own tooltip.
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

  /** Like show(), but anchored to raw cursor coordinates instead of a target element's rect --
   * for a crosshair-style hover that tracks the pointer across a continuous chart. */
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

/** Spread onto an element in place of `title="..."` to use the shared TooltipManager instead
 * of the browser's default tooltip. */
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

  getImage: (path: string): string => `/images/${path}`,
  getData: (path: string): string => `/data/${path}`,

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
   * Builds the "Name-WI-S#" id fragments used in exported rotation/team filenames and labels,
   * one per team slot that has a character (weapon initials appended if a weapon is set, then
   * the sequence if it's above S0 -- omitted at S0 the same way a blank weapon is, since that's
   * the common/base case and every fragment staying short matters more there than completeness).
   * Sequence materially changes a build's damage output (see Sanhua's resonance chain passives),
   * so a saved file's own name should be enough to tell two exports of the same character/weapon
   * apart without having to open the file.
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
   * Parses multiplier strings ("150%", "[50%, 100%]", "120") into an array of numbers/percent
   * strings. A '%' suffix is preserved (as "N%"), not stripped -- CombatCalculator.
   * calculateDamageInstance keys off exactly that suffix to decide whether a hit mult scales
   * off the move's scalar stat ("150%" -> pctMult) or is a flat added value ("120" -> flatMult,
   * e.g. Tune Break's stat-independent hitMults). Dropping the '%' here would silently turn
   * every percent mult typed into this field into a flat value instead.
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