// Where game data and images are fetched from. All dev-only WIP mirror logic lives here.

// Public GitHub owner/repo/branch -- not a secret.
export const DATA_REPO_BASE_URL = 'https://raw.githubusercontent.com/jjc-astra/wuwa-calc-data/main';

// Gitignored local mirror of the data repo's data/ and images/ folders (site/public/wip-data/),
// for testing a unit before it is pushed to the data repo.
const WIP_BASE_URL = '/wip-data';

// Build-time constant, so WIP branches are stripped from prod bundles.
export const WIP_ENABLED = import.meta.env.DEV;

// Dev builds try the WIP mirror first and fall back to the real repo on a miss
// (DataLoader.loadJSON for data, installWipImageFallback for images).
const preferredBase = WIP_ENABLED ? WIP_BASE_URL : DATA_REPO_BASE_URL;
export const imageUrl = (path: string): string => `${preferredBase}/images/${path}`;
export const dataUrl = (path: string): string => `${preferredBase}/data/${path}`;

// Bypass WIP. loadMergedDB needs both: a WIP copy of a combined DB file (db_characters.json)
// is merged on top of the real one, never swapped in, or entries it omits would vanish.
export const realDataUrl = (path: string): string => `${DATA_REPO_BASE_URL}/data/${path}`;
export const wipDataUrl = (path: string): string => `${WIP_BASE_URL}/data/${path}`;

export const isWipUrl = (url: string): boolean => WIP_ENABLED && url.startsWith(WIP_BASE_URL);
export const wipToRealUrl = (url: string): string => url.replace(WIP_BASE_URL, DATA_REPO_BASE_URL);
// The path inside data/ (the manifest key), from either source.
export const dataRelPath = (url: string): string =>
  url.replace(`${WIP_BASE_URL}/data/`, '').replace(`${DATA_REPO_BASE_URL}/data/`, '');

// Swaps a failed WIP image to the real repo. <img> error events don't bubble but do fire in the
// capture phase, so one capturing listener on `window` covers every image. It runs before
// components' own onError handlers and stops them, so they only see a failure from the real repo.
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
