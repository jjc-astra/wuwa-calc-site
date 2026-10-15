// Data and image URLs, including the dev-only WIP mirror.

// Prod: same origin. Dev: raw GitHub.
const DATA_REPO_BASE_URL = import.meta.env.DEV
  ? 'https://raw.githubusercontent.com/jjc-astra/wuwa-calc-data/main'
  : import.meta.env.BASE_URL.replace(/\/$/, '');

// Gitignored local mirror for testing unpublished data.
const WIP_BASE_URL = '/wip-data';

export const WIP_ENABLED = import.meta.env.DEV;

// Dev: WIP mirror first, falling back to the real repo.
const preferredBase = WIP_ENABLED ? WIP_BASE_URL : DATA_REPO_BASE_URL;
export const imageUrl = (path: string): string => `${preferredBase}/images/${path}`;
export const dataUrl = (path: string): string => `${preferredBase}/data/${path}`;

// Bypasses WIP (for loadMergedDB).
export const realDataUrl = (path: string): string => `${DATA_REPO_BASE_URL}/data/${path}`;
export const wipDataUrl = (path: string): string => `${WIP_BASE_URL}/data/${path}`;

// Dev server WIP manifest endpoint.
export const WIP_FILES_URL = '/__wip-files';

export const isWipUrl = (url: string): boolean => WIP_ENABLED && url.startsWith(WIP_BASE_URL);
export const wipToRealUrl = (url: string): string => url.replace(WIP_BASE_URL, DATA_REPO_BASE_URL);
// Path inside data/ (the manifest key).
export const dataRelPath = (url: string): string =>
  url.replace(`${WIP_BASE_URL}/data/`, '').replace(`${DATA_REPO_BASE_URL}/data/`, '');

// Retries failed WIP images from the real repo via one capturing error listener.
export function installWipImageFallback(): void {
  if (!WIP_ENABLED) return;
  const wipOrigin = window.location.origin + WIP_BASE_URL;
  window.addEventListener(
    'error',
    e => {
      const target = e.target;
      if (!(target instanceof HTMLImageElement) || !target.src.startsWith(wipOrigin)) return;
      e.stopImmediatePropagation();
      target.src = DATA_REPO_BASE_URL + target.src.slice(wipOrigin.length);
    },
    true
  );
}
