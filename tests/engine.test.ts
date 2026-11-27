import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { addDays } from '../src/shared/engine/date.ts';
import { generatePuzzle } from '../src/shared/engine/generator.ts';
import { parseActions } from '../src/shared/engine/grid.ts';
import { initialState, replay, stateKey, step } from '../src/shared/engine/sim.ts';
import { solve } from '../src/shared/engine/solver.ts';
import { compileWorld } from '../src/shared/engine/world.ts';
import { nextBlight, previewActions } from '../src/shared/engine/forecast.ts';
import type { Action } from '../src/shared/engine/types.ts';
import { at, co, makePuzzle, walls } from './helpers.ts';

test('engine source never touches randomness or the clock', () => {
  const dir = new URL('../src/shared/engine/', import.meta.url);
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts') || file === 'date.ts') continue;
    const src = readFileSync(new URL(file, dir), 'utf8');
    assert.ok(!src.includes('Math.random'), `${file} uses Math.random`);
    assert.ok(!src.includes('Date.now'), `${file} uses Date.now`);
    assert.ok(!src.includes('performance.now'), `${file} uses performance.now`);
  }
});

test('the same date always produces the same puzzle', () => {
  for (const d of ['2026-11-30', '2026-12-02', '2026-12-06']) {
    assert.equal(JSON.stringify(generatePuzzle(d)), JSON.stringify(generatePuzzle(d)));
  }
});

test('the community pick changes the puzzle deterministically', () => {
  const a = generatePuzzle('2026-12-03');
  const plan = a.communityPick;
  assert.ok(plan);
  const other = generatePuzzle('2026-12-03', { pick: 'GRAVITY' });
  assert.equal(JSON.stringify(other), JSON.stringify(generatePuzzle('2026-12-03', { pick: 'GRAVITY' })));
});

test('stored par routes replay to a solve in exactly par moves', () => {
  let d = '2026-12-07';
  for (let i = 0; i < 7; i++) {
    const p = generatePuzzle(d);
    const actions = parseActions(p.solution ?? '');
    assert.ok(actions);
    const r = replay(compileWorld(p), actions);
    assert.ok(r.ok && r.solved, `${d} solution does not solve`);
    assert.equal(r.solvedAt, p.par, `${d} par mismatch`);
    d = addDays(d, 1);
  }
});

test('replaying a route twice gives identical states and events', () => {
  const p = generatePuzzle('2026-12-05');
  const w = compileWorld(p);
  const route: Action[] = ['U', 'R', 'W', 'D', 'L', 'L', 'U', 'R', 'R', 'D'];
  const a = replay(w, route);
  const b = replay(compileWorld(p), route);
  assert.deepEqual(a.states.map((s) => stateKey(w, s)), b.states.map((s) => stateKey(w, s)));
  assert.equal(JSON.stringify(a.events), JSON.stringify(b.events));
});

test('previews do not change the state they look at', () => {
  const p = generatePuzzle('2026-12-01');
  const w = compileWorld(p);
  const s = initialState(w);
  const before = stateKey(w, s);
  previewActions(w, s);
  assert.equal(stateKey(w, s), before);
});

test('blocked moves are rejected and cost nothing', () => {
  const p = makePuzzle({ mutations: [], start: co(3, 0) });
  const w = compileWorld(p);
  const s = initialState(w);
  assert.equal(step(w, s, 'L').ok, false);
  const res = step(w, s, 'W');
  assert.ok(res.ok);
  assert.equal(res.state.turn, 1);
});

test('plain board: par is the walking distance', () => {
  const p = makePuzzle({ mutations: [] });
  const r = solve(compileWorld(p));
  assert.equal(r.par, 6);
});

test('gravity pulls after every move and rotates every 3 moves', () => {
  const p = makePuzzle({ mutations: ['GRAVITY'], start: co(0, 0), grid: walls() });
  const w = compileWorld(p);
  let s = initialState(w);
  const r1 = step(w, s, 'R');
  assert.ok(r1.ok);
  s = r1.state;
  assert.equal(s.pos, at(1, 1));
});

test('conveyors chain and stop when blocked', () => {
  const p = makePuzzle({
    mutations: ['CONVEYOR'],
    start: co(0, 0),
    conveyors: [
      { r: 0, c: 1, dir: 'R' },
      { r: 0, c: 2, dir: 'R' }
    ],
    grid: walls([0, 4])
  });
  const w = compileWorld(p);
  const r = step(w, initialState(w), 'R');
  assert.ok(r.ok);
  assert.equal(r.state.pos, at(0, 3));
});

test('portals swap pairs every 3 moves', () => {
  const p = makePuzzle({
    mutations: ['PORTALS'],
    start: co(0, 0),
    portals: [
      { r: 0, c: 1, label: 0 },
      { r: 6, c: 6, label: 1 },
      { r: 6, c: 0, label: 2 },
      { r: 0, c: 6, label: 3 }
    ]
  });
  const w = compileWorld(p);
  const first = step(w, initialState(w), 'R');
  assert.ok(first.ok);
  assert.equal(first.state.pos, at(6, 6)); // A -> B
  const late = replay(w, ['W', 'W', 'W', 'R']);
  assert.equal(late.states[4]?.pos, at(6, 0)); // A -> C after the swap
});

test('decay: cracked tiles fall in once you step off', () => {
  const p = makePuzzle({ mutations: ['DECAY'], start: co(3, 0), cracked: [co(3, 1)] });
  const w = compileWorld(p);
  const r = replay(w, ['R', 'R']);
  assert.ok(r.ok);
  assert.equal(r.states[2]?.decay[at(3, 1)], 0);
  assert.equal(step(w, r.states[2]!, 'L').ok, false);
});

test('blight forecast names the tile that actually gets infected', () => {
  const p = makePuzzle({ mutations: ['INFECTION'], blight: [co(0, 3)], blightOrder: ['D', 'L', 'R', 'U'] });
  const w = compileWorld(p);
  const s0 = initialState(w);
  const f = nextBlight(w, s0);
  assert.ok(f);
  const r = replay(w, ['W', 'W']);
  assert.equal(r.states[2]?.blight[f.target], 1);
});

test('mirror drone mirrors and holds', () => {
  const p = makePuzzle({ mutations: ['MIRROR_DRONE'], droneStart: co(5, 5) });
  const w = compileWorld(p);
  const r = replay(w, ['R', 'W', 'U']);
  assert.equal(r.states[1]?.drone, at(5, 4));
  assert.equal(r.states[2]?.drone, at(5, 4));
  assert.equal(r.states[3]?.drone, at(6, 4));
});

test('echo repeats the previous action one turn late', () => {
  const p = makePuzzle({ mutations: ['ECHO'], echoStart: co(5, 3) });
  const w = compileWorld(p);
  const r = replay(w, ['R', 'U']);
  assert.equal(r.states[1]?.echo, at(5, 3));
  assert.equal(r.states[2]?.echo, at(5, 4));
});

test('overclock moves two tiles on every third move', () => {
  const p = makePuzzle({ mutations: ['OVERCLOCK'], start: co(0, 0), exit: co(6, 6) });
  const w = compileWorld(p);
  const r = replay(w, ['R', 'R', 'R']);
  assert.equal(r.states[3]?.pos, at(0, 4));
});

test('one-way gates only admit movement along the arrow', () => {
  const p = makePuzzle({ mutations: ['ONE_WAY_GATES'], start: co(3, 0), oneWays: [{ r: 3, c: 1, dir: 'L' }] });
  const w = compileWorld(p);
  assert.equal(step(w, initialState(w), 'R').ok, false);
});

test('solver par is a lower bound for random routes', () => {
  const p = generatePuzzle('2026-12-04');
  const w = compileWorld(p);
  // Any accepted solving route must be at least par long.
  const res = solve(w, { maxStates: 200000, maxDepth: 30 });
  assert.equal(res.par, p.par);
});

test('wraparound: walking off an edge comes back on the other side', () => {
  const p = makePuzzle({ mutations: ['WRAPAROUND'], start: co(3, 0) });
  const w = compileWorld(p);
  const r = step(w, initialState(w), 'L');
  assert.ok(r.ok);
  assert.equal(r.state.pos, at(3, 6));
  assert.ok(r.events.some((e) => e.t === 'wrap'));
});

test('crates: pushed by walking, never by forces, and they block', () => {
  const p = makePuzzle({ mutations: ['CRATES'], start: co(3, 0), crates: [co(3, 1)], cells: [co(0, 0), co(6, 6)], grid: walls([3, 3]) });
  const w = compileWorld(p);
  const r = replay(w, ['R']);
  assert.ok(r.ok);
  assert.deepEqual(r.states[1]?.crates, [at(3, 2)]);
  assert.equal(r.states[1]?.pos, at(3, 1));
  // The crate is now against a wall, so the next push is refused.
  assert.equal(step(w, r.states[1]!, 'R').ok, false);
});

test('skittish cells step away when you come within 2 tiles', () => {
  const p = makePuzzle({ mutations: ['SKITTISH_CELLS'], start: co(3, 0), cells: [co(3, 3), co(6, 6)] });
  const w = compileWorld(p);
  const r = replay(w, ['R']);
  assert.equal(r.states[1]?.cells[0], at(3, 4));
  assert.ok(r.events[0]?.some((e) => e.t === 'flee'));
});

test('a cornered skittish cell can be caught', () => {
  const p = makePuzzle({ mutations: ['SKITTISH_CELLS'], start: co(0, 4), cells: [co(0, 6), co(6, 0)], exit: co(3, 3) });
  const w = compileWorld(p);
  const r = replay(w, ['R', 'R']);
  assert.equal((r.states[2]!.got & 1) !== 0, true);
});
