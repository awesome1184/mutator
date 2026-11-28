# MUTATOR

A daily puzzle for Reddit. Each day you get a 7×7 well plate and the same goal:
pick up both cells, then reach the exit. What changes is the rules. Every day
splices two mutations into the physics (Sunday gets three), drawn from a roster
of 34: gravity that swings around the clock, portals that re-pair every three
moves, floor that cracks behind you, a drone that mirrors you, blight that
creeps one tile every other move, cells that run away from you, crates to
push, edges that wrap around, springs, keys and locks, paint barriers, mud,
and more.

There's no luck involved. The only randomness is in building the day's board.
After that, the same moves always produce the same result, and everything the
world is about to do is shown before you move: the gravity direction for the
next few moves, which gates close, where the blight grows next, where each of
your moves would land you. Par is the true minimum, worked out by a solver that
checks every reachable state.

Built with Devvit Web for Reddit's Game of the Day hackathon.

## How to play

- Swipe on the board, tap a neighbouring well, or use the pad. Arrow keys and
  WASD also work. Space holds for a move, Z undoes, R restarts.
- Hold skips your move, but the world still takes its turn.
- Moves that would go nowhere are refused and cost nothing.
- Your first solve of the day is the one that counts. Undo and restart are
  free, but the board records how many you used and uses them to break ties.
- After solving you can vote on which mutation gets spliced into tomorrow's
  puzzle, post your result (with your route behind a spoiler) as a comment,
  watch a par route, or keep playing for practice.

### The week

| Day | Difficulty | Mutations | Par range |
| --- | --- | --- | --- |
| Monday | Warm-up | 1 (picked by vote) | 6–11 |
| Tuesday | Standard | 2 | 8–13 |
| Wednesday | Tricky | 2 | 9–15 |
| Thursday | Tricky | 2 | 10–16 |
| Friday | Hard | 2 | 11–18 |
| Saturday | Expert | 2 | 12–22 |
| Sunday | Anomaly | 3 | 10–22 |

One slot each day is chosen by the community the day before. The fixed slots
cycle through the whole roster, so every mutation comes round regularly.

Mutations are split into two pools that players never see. The core pool
changes how you move (gravity, ice, belts, portals, springs, paint and so on).
The mild pool adds an obstacle or a timer to an otherwise normal board (gates,
doors, flood, keys, mud and so on). A day never gets two mild mutations, and
Monday's single mutation is always from the core pool, so no day is just two
small tweaks on a plain board. The pools are defined by the `pool` field in
`src/shared/engine/mutations.ts` and enforced in `schedule.ts`.

## What's on Reddit

- **Puzzles built ahead.** An hourly job builds tomorrow's puzzle for each
  possible vote outcome, one per run, so the daily post never waits on the
  generator. If a draft is missing, the puzzle is built on demand as before.
- **A daily post.** A scheduled job creates the day's post at 00:01 UTC, pins
  it, unpins yesterday's, and comments a short recap of yesterday (solvers,
  share on par, top three).
- **An in-feed preview.** It shows the starting board, today's rules, par and
  how many people have solved it. The game opens in expanded view.
- **A board per puzzle.** Ranked by moves, then fewest undos and restarts, then
  who finished first. It shows snoovatars, and there's a separate streak board.
- **Streaks and a catalogue** of the mutations you've beaten.
- **Optional streak flair.** A player can opt in to showing their streak as
  user flair in the community.
- **Comment sharing.** "Post my result as a comment" writes your score as you,
  with the route hidden behind a spoiler.
- **A vote.** It decides tomorrow's community mutation.
- **An archive** of past days. Older puzzles are playable and ranked on their
  own day's board, but they don't extend streaks.

## What changed from the earlier version

The previous version was a single 6,000-line React file that no longer
compiled. It also hid information the player needed: the infection target was
secret, and the UI didn't fit on a phone. This rebuild:

- rewrites the engine in typed, pure TypeScript shared by client and server
  (`src/shared/engine`), with a precise turn order and a Hold action;
- makes the server replay every submitted route, so a score is only accepted
  if the moves really solve the puzzle;
- adds forecasts, landing previews and connector lines (portal pairs, plates
  to doors, magnet and cell pulls acting on you, the gravity direction), so
  nothing the world does is hidden;
- adds seven new mutations: Wraparound, Skittish Cells, Crates, Springs,
  Paint, Keys & Locks and Mud;
- adds a generator that targets a par range per weekday and rejects boards
  where any active mutation doesn't change the best route (checked by removing
  each mutation and re-solving);
- reworks Decay (now cracked tiles that hold for one crossing) so it reliably
  matters and stays solvable;
- adds Devvit integration: daily posts, Redis-backed results, leaderboards,
  streaks, votes, flair, comments and an archive;
- replaces the whole UI with a new design that fits a phone screen without
  scrolling.

## Difficulty

Par alone doesn't say whether a puzzle is hard: a long walk can still be
obvious. So the generator also plays each candidate board as a naive player.
That player looks one to three moves ahead (the landing previews show one),
heads for whatever leaves the shortest walk to the cells and the exit, and will
make a single stop for a key, a paint splash or a door plate when it opens a
shorter walk. They use the belts and portals they can see.

The difficulty of a board is how many moves over par that player ends up. Each
weekday has a target:

| Day | Naive player at least this far over par |
| --- | --- |
| Monday | 1 (but no more than 5) |
| Tuesday | 2 (but no more than 7) |
| Wednesday, Thursday | 3 |
| Friday | 4 |
| Saturday | 5 |
| Sunday | 4 |

The generator first tries fresh boards, then climbs: it nudges the most
promising boards one tile at a time (a wall, a feature, a cell or the exit),
mostly on the route the naive player takes, and keeps a nudge when it makes the
board harder. Throughout, a board must keep par in range and every mutation
must still change the best route. The naive player lives in
`src/shared/engine/difficulty.ts`.

## Determinism

- `src/shared/engine` never reads the clock or `Math.random`. A unit test
  enforces this.
- A puzzle is a pure function of its date and the voted mutation, and it is
  stored the first time it is generated, so later code changes can't alter a
  past day. Bump `RULES_VERSION` in `src/shared/engine/grid.ts` whenever
  movement rules change.
- The generator's effort is capped by a fixed state budget, not by time, so it
  produces the same board on every machine.
- Ties in the vote go to the first candidate in a fixed order.

## Project layout

```
devvit.json              Devvit config: entrypoints, menu, triggers, daily cron
src/shared/engine/       rules, solver, generator, daily schedule (pure)
src/shared/service.ts    game service (results, streaks, votes) over a tiny KV
src/server/              Hono server for Devvit: /api routes, daily post job
src/client/              React client: splash.html (in feed), game.html (expanded)
tests/                   engine and service tests (node --test)
tools/                   audit scripts for generated days and mutation pairs
```

## Running it

You need Node 24 (see `.nvmrc`).

```bash
npm install
npm run test:unit        # engine + service tests
npm run type-check
npm run dev:web          # standalone browser version on localhost
npm run build:web        # standalone build to dist/web (used by GitHub Pages)
```

For a single file you can open from disk with no server or internet, run
`npm run build:offline`. It writes `dist/offline/mutator.html`. Its Past
panel has a test bench for loading a scratch board with any mutations.

The standalone version runs the same game service in the browser on
localStorage, so you can play without Reddit. It has a **Next day** button
next to the date that moves its clock forward a day, so you can test the next
puzzle, the vote result and streaks without waiting. The "days ahead, reset"
button next to it goes back to the real date. Neither appears on Reddit. Add `?muts=GRAVITY,DECAY` to the
URL to try any combination of mutations on a scratch board.

### On Reddit

```bash
npm run login            # devvit login, opens a browser
npm run dev              # devvit playtest: creates r/<app>_dev and a test post
npm run deploy           # type-check, tests, devvit upload
```

The app name is `mutator-daily` in `devvit.json` and `package.json`. If Reddit
says the name is taken, change it in both files before the first upload.

In a subreddit where the app is installed, moderators get a menu item,
**MUTATOR: post today's puzzle**. The install trigger and the daily job create
the post automatically.

### Audits

```bash
npm run audit:days -- 2026-12-01 28    # generate four weeks, check par and timing
npm run audit:pairs -- 2026-12-02      # every two-mutation combination
npm run audit:difficulty -- 2026-12-05 # how hard each pairing comes out
```

At the time of writing, every single mutation and every two-mutation pair
generates without falling back to the emergency board. In a 42-day run every
puzzle landed in its par range. Generation takes 2 to 10 s per day.

## Hackathon checklist

- App listing: `https://developers.reddit.com/apps/<app-name>` (exists after
  the first `devvit upload`).
- Demo post: a public test subreddit (under 200 members) with the app installed
  and today's post created.
- Don't run `devvit publish` during the hackathon. Keep the app uploaded and
  playtestable through judging.
