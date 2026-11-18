# MUTATOR

A daily grid puzzle about adapting to changing rules. Collect both Energy Cells, navigate the active mutations, and reach the exit in as few moves as possible.

## Run locally

Requires Node.js 20.19+ (Node.js 22 is recommended).

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## GitHub Pages

The `Deploy MUTATOR to GitHub Pages` workflow builds the Vite app and publishes it whenever a commit is pushed to `main`. The production build uses the `/mutator/` base path for this repository.

Before the first deployment, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**.

The playable game remains in `mutator_daily_grid_puzzle.tsx`; the Vite files provide the web entry point and deployment setup.
