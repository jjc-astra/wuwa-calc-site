# WuWa Calculator

A web tool for planning and optimizing Wuthering Waves team rotations, live at
[wuwacalc.com](https://wuwacalc.com/).

- **Rotation Calculator**: build a team and a rotation, then see its DPS, damage over time,
  contribution breakdowns, substat worth and a timeline.
- **Mechanics Builder**: author and edit the character, weapon, echo and set mechanics the
  calculator runs on.
- **Rotation Rankings**: leaderboards of submitted rotations.
- **Character Guide**: per-character builds and team comparisons, calculated from the ranked rotations.
- **About**: flowcharts of how the codebase works (`src/components/about/`).

Game data and images live in a separate repo,
[wuwa-calc-data](https://github.com/jjc-astra/wuwa-calc-data). The site fetches them at runtime,
so new data doesn't need a site rebuild.

Built with React, TypeScript and Vite. Zustand manages state, and the simulation runs in a Web
Worker.

## Dev setup

1. Install [Node.js](https://nodejs.org/) 22 or newer (npm comes with it).
2. Clone the repo and install dependencies:
   ```bash
   git clone https://github.com/jjc-astra/wuwa-calc-site.git
   cd wuwa-calc-site/site
   npm install
   ```
3. Start the dev server:
   ```bash
   npm run dev
   ```
   Open [http://localhost:5173](http://localhost:5173). Edits hot-reload.

You don't need a local copy of the data: the dev site reads straight from the public data repo.

### Testing unpublished data (optional)

To try new or edited data before pushing it to the data repo, mirror its `data/` and `images/`
folders under `site/public/wip-data/`. The folder is gitignored and nothing in it is committed.

- In dev builds, data and image URLs resolve there first (`site/src/utils/dataSource.ts`). A file that
  exists is used, and a missing one falls back to the real repo.
- Production builds never read it.
- `data/mechanics/{characters,weapons,sets,echoes,system}/<Name>.json` is **replaced** whole: the
  file fully replaces that entity's mechanics.
- `data/db_characters.json`, `db_weapons.json`, `db_builds.json` and `db_echoes.json` are
  **merged** by top-level key. Include only the entries you're adding or editing
  (e.g. `{"Luuk": {...}}`), and every other real entry stays.
  - `db_echoes.json`'s `SET_ECHO_MAPPING`, `THREE_PC_SETS` and `ONE_PC_SETS` are top-level keys,
    so an override replaces that whole key. To add one sonata set, copy the full object or list
    and add to it.
- `images/{characters,weapons,echoes,echo sets,system}/Icon_<Name>.webp` is **replaced**. A
  missing icon falls back to the real repo's.

Use the real repo's exact paths and filenames:

- Mechanics files replace spaces with underscores (`Impermanence_Heron.json`). Icons drop them
  (`Icon_ImpermanenceHeron.webp`).
- System mechanics live in `mechanics/system/system.json`, and the System icon is
  `images/system/Icon_Generic.webp`.
- If a filename isn't obvious, see `DataLoader.mechanicPath` in `site/src/utils/DataLoader.ts`.

Vite copies `site/public/` into `site/dist/`, so a local `npm run build` includes the mirror. Deploys
aren't affected, because CI never has the folder.

## Scripts

Run these from `site/`.

| Command           | What it does                                        |
| ----------------- | --------------------------------------------------- |
| `npm run dev`     | Dev server with hot reload                          |
| `npm run build`   | Type-checks, then builds to `site/dist/`            |
| `npm run preview` | Serves the `site/dist/` build locally               |
| `npm run lint`    | Runs ESLint                                         |

## Deploying

Pushing to `main` builds the site and deploys it to GitHub Pages
(`.github/workflows/deploy.yml`).
