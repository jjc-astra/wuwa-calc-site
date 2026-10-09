// Dependency-free: vite.config.ts imports this too, to emit each route's static HTML page.

export type ViewId = 'landing' | 'calculator' | 'builder' | 'rankings' | 'guide' | 'about';

export const VIEW_IDS: ViewId[] = ['landing', 'calculator', 'builder', 'rankings', 'guide', 'about'];

export const SITE_URL = 'https://wuwacalc.com';
export const SITE_NAME = 'WuWa Calculator';

export interface PageMeta {
  title: string;
  description: string;
}

/** Each view's <title> and meta description: baked into its static page at build, and set on navigation. */
export const PAGE_META: Record<ViewId, PageMeta> = {
  landing: {
    title: 'WuWa Calculator | Wuthering Waves Damage & Rotation Calculator',
    description: 'Free Wuthering Waves calculator and rotation simulator. Calculate character damage, team DPS, weapon and echo set value, and substat worth across full combat rotations.'
  },
  calculator: {
    title: 'Rotation Calculator | WuWa Calculator',
    description: 'Build a Wuthering Waves team with weapons, echoes and sonata sets, lay out its rotation, and see total damage, DPS, contribution breakdowns and a hit-by-hit timeline.'
  },
  builder: {
    title: 'Mechanics Builder | WuWa Calculator',
    description: 'Author and edit the character, weapon, echo and sonata set mechanics that the WuWa Calculator\'s Wuthering Waves damage simulation runs on.'
  },
  rankings: {
    title: 'Rotation Rankings | WuWa Calculator',
    description: 'Wuthering Waves rotation leaderboards: compare optimized team rotations and DPS across teams and characters.'
  },
  guide: {
    title: 'Character Guide | WuWa Calculator',
    description: 'Wuthering Waves character builds and team comparisons, calculated from optimized ranked rotations.'
  },
  about: {
    title: 'About | WuWa Calculator',
    description: 'How the WuWa Calculator works: flowcharts of its Wuthering Waves combat simulation, data pipeline and codebase.'
  }
};

/** A Character Guide character's page: its own static page at build when it has ranked rotations. */
export const guideCharacterMeta = (character: string): PageMeta => ({
  title: `${character} Guide | ${SITE_NAME}`,
  description: `${character} builds and teams for Wuthering Waves: weapon, echo and sequence comparisons calculated from optimized ranked rotations.`
});

// Paths end in "/" to match GitHub Pages' <view>/index.html files, which it 301s to otherwise.
export const viewPath = (view: ViewId): string => (view === 'landing' ? '/' : `/${view}/`);

export const calculatorPath = (step: 1 | 2): string => `/calculator/step-${step}/`;

export const guidePath = (character?: string): string =>
  character ? `/guide/${encodeURIComponent(character)}/` : '/guide/';
