import type { ImageFolder } from '../data/db';

export const EXTENSION = '.webp';
export const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

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

  hide(): void {
    if (this.el) this.el.style.display = 'none';
  }
}

export const TooltipManager = new TooltipManagerClass();

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
   * Parses multiplier strings ("150%", "[50%, 100%]", "120") into an array of numbers.
   */
  parseMultiplierString: (raw: any): number[] | undefined => {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const str = String(raw).trim();
    if (str.startsWith('[') && str.endsWith(']')) {
      try {
        const arr = JSON.parse(str.replace(/'/g, '"'));
        if (Array.isArray(arr)) {
          return arr.map(v => typeof v === 'number' ? v : (parseFloat(String(v).replace('%', '')) || 0));
        }
      } catch (e) { /* ignore JSON parse error */ }
    }
    if (str.includes(',')) {
      return str.split(',').map(s => parseFloat(s.trim().replace('%', '')) || 0);
    }
    const num = parseFloat(str.replace('%', ''));
    return isNaN(num) ? undefined : [num];
  }
};