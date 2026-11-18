# MUTATOR

A daily grid puzzle about adapting to changing rules. Collect both Energy Cells, navigate the active mutations, and reach the exit in as few moves as possible.

## Run locally

Requires Node.js 20.19+ or 22.12+ (Node.js 22.12+ is recommended).

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Mutation modules

MUTATOR currently has 27 mutation modules, creating 351 possible two-module pairings. Daily puzzles normally select two modules. Payload Mass can add one compatible host module when it needs one.

The ten newest modules are:

- **Reflectors:** bend movement by 90 degrees
- **Echo:** replay the Courier's previous direction one turn later
- **One-Way Gates:** allow entry only in the arrow direction
- **Orbital Cells:** move uncollected Energy Cells around four-tile loops
- **Pulse Beam:** sweep a telegraphed row or column, active every other turn
- **Ventilation:** push the Courier from vent tiles on alternating turns
- **Inertia:** repeating a direction carries movement one extra tile
- **Flood:** advance from a marked edge, up to two tiles deep
- **Phase Layers:** alternate which marked tiles are solid
- **Rotors:** rotate the next input by 90 degrees

## Difficulty and balance

The puzzle generator uses the same deterministic turn simulator as the player and its BFS solver to find an optimal route. Candidate daily layouts target 7–22 optimal moves. Random wall density is reduced when the selected mutations already add blocking terrain or moving hazards. Overclock and Inertia share a two-tile movement cap, Flood stops after two tiles, and Pulse Beam's active line is shown before the move.

## GitHub Pages

The `Deploy MUTATOR to GitHub Pages` workflow builds the Vite app and publishes it whenever a commit is pushed to `main`. The production build uses the `/mutator/` base path for this repository.

Before the first deployment, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**.

The playable game remains in `mutator_daily_grid_puzzle.tsx`; the Vite files provide the web entry point and deployment setup.
