import { test } from 'node:test';
import assert from 'node:assert/strict';
import { naiveGap, naiveMoves } from '../src/shared/engine/difficulty.ts';
import { initialState } from '../src/shared/engine/sim.ts';
import { solve } from '../src/shared/engine/solver.ts';
import { compileWorld } from '../src/shared/engine/world.ts';
import { co, makePuzzle, walls } from './helpers.ts';

test('a straight walk is easy: the naive player matches par', () => {
  const w = compileWorld(makePuzzle({ mutations: [] }));
  const par = solve(w).par;
  assert.equal(par, 6);
  assert.equal(naiveMoves(w, initialState(w), 1, 20), 6);
  assert.equal(naiveGap(w, initialState(w), par), 0);
});

test('a single errand (a plate for a door) is within the naive player', () => {
  const w = compileWorld(
    makePuzzle({
      mutations: ['BLAST_DOORS'],
      grid: walls([0, 5], [1, 5]),
      exit: co(0, 6),
      doors: [co(1, 6)],
      plates: [co(6, 0)],
      start: co(3, 3),
      cells: [co(3, 4), co(3, 2)]
    })
  );
  const par = solve(w).par;
  assert.ok(naiveGap(w, initialState(w), par) <= 1);
});

test('the naive player is deterministic', () => {
  const w = compileWorld(makePuzzle({ mutations: ['GRAVITY'], start: co(0, 0), cells: [co(6, 6), co(0, 6)], exit: co(6, 0) }));
  const par = solve(w).par;
  assert.equal(naiveGap(w, initialState(w), par), naiveGap(w, initialState(w), par));
});
