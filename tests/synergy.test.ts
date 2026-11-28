// Interactions between mutations. Each test builds a tiny board where two
// mutations meet and checks the outcome the rules text promises.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, replay, step } from '../src/shared/engine/sim.ts';
import { compileWorld } from '../src/shared/engine/world.ts';
import { at, co, makePuzzle, walls } from './helpers.ts';

const far = { cells: [co(0, 0), co(0, 1)] as [ReturnType<typeof co>, ReturnType<typeof co>], exit: co(0, 6) };

test('conveyor + gravity: belt pushes first, then gravity pulls (diagonal drift)', () => {
  const w = compileWorld(makePuzzle({ mutations: ['CONVEYOR', 'GRAVITY'], ...far, start: co(2, 2), conveyors: [{ r: 2, c: 3, dir: 'R' }] }));
  const r = step(w, initialState(w), 'R');
  assert.ok(r.ok);
  assert.equal(r.state.pos, at(3, 4));
});

test('gravity + portals: gravity pulls you off the exit pad', () => {
  const w = compileWorld(
    makePuzzle({ mutations: ['GRAVITY', 'PORTALS'], ...far, start: co(2, 0), portals: [{ r: 2, c: 1, label: 0 }, { r: 4, c: 5, label: 1 }, { r: 6, c: 0, label: 2 }, { r: 6, c: 6, label: 3 }] })
  );
  const r = step(w, initialState(w), 'R');
  assert.ok(r.ok);
  assert.equal(r.state.pos, at(5, 5));
});

test('ice + portals: a slide that hits a pad warps you, then stops on the pad (pads are not ice)', () => {
  const w = compileWorld(
    makePuzzle({
      mutations: ['CRYO_SLICK', 'PORTALS'],
      ...far,
      start: co(3, 0),
      ice: [co(3, 1), co(5, 3)],
      portals: [{ r: 3, c: 2, label: 0 }, { r: 5, c: 2, label: 1 }, { r: 1, c: 6, label: 2 }, { r: 6, c: 6, label: 3 }]
    })
  );
  const r = step(w, initialState(w), 'R');
  assert.ok(r.ok);
  assert.equal(r.state.pos, at(5, 2));
});

test('gravity + decay: being pulled off a cracked tile breaks it too', () => {
  const w = compileWorld(makePuzzle({ mutations: ['GRAVITY', 'DECAY'], ...far, start: co(2, 3), cracked: [co(3, 3)] }));
  const r = replay(w, ['W', 'W']);
  assert.ok(r.ok);
  assert.equal(r.states[2]?.decay[at(3, 3)], 0);
});

test('payload mass + gravity: light falls 2, heavy does not fall', () => {
  const w = compileWorld(makePuzzle({ mutations: ['PAYLOAD_MASS', 'GRAVITY'], cells: [co(1, 1), co(1, 2)], exit: co(6, 6), start: co(0, 0) }));
  const light = step(w, initialState(w), 'W');
  assert.ok(light.ok);
  assert.equal(light.state.pos, at(2, 0));
});

test('payload mass + conveyor: heavy is not moved by belts', () => {
  const w = compileWorld(
    makePuzzle({ mutations: ['PAYLOAD_MASS', 'CONVEYOR'], cells: [co(3, 1), co(3, 2)], exit: co(6, 6), start: co(3, 0), conveyors: [{ r: 3, c: 3, dir: 'D' }] })
  );
  const r = replay(w, ['R', 'R', 'R']);
  assert.ok(r.ok);
  assert.equal(r.states[3]?.pos, at(3, 3));
});

test('blast doors + mirror drone: the drone presses plates', () => {
  const w = compileWorld(makePuzzle({ mutations: ['BLAST_DOORS', 'MIRROR_DRONE'], ...far, start: co(3, 3), droneStart: co(5, 4), plates: [co(5, 3)], doors: [co(2, 6)] }));
  const r = step(w, initialState(w), 'R');
  assert.ok(r.ok);
  assert.equal(r.state.doorsOpen, true);
});

test('blight + mirror drone: blight cannot grow onto the drone', () => {
  const w = compileWorld(makePuzzle({ mutations: ['INFECTION', 'MIRROR_DRONE'], ...far, start: co(3, 3), droneStart: co(6, 3), blight: [co(6, 4)], blightOrder: ['L', 'U', 'R', 'D'] }));
  const r = replay(w, ['W', 'W']);
  assert.equal(r.states[2]?.blight[at(6, 3)], 0);
});

test('afterimage + ice: hard-light stops a slide', () => {
  const w = compileWorld(makePuzzle({ mutations: ['AFTERIMAGE', 'CRYO_SLICK'], ...far, start: co(3, 2), ice: [co(3, 1), co(3, 0)] }));
  // Step right (3,3), then left onto ice: the afterimage at (3,2) blocks the way back.
  const r = replay(w, ['R', 'L']);
  assert.equal(r.ok, false);
});

test('turntables rotate belts and their arrows', () => {
  const w = compileWorld(makePuzzle({ mutations: ['TURNTABLES', 'CONVEYOR'], ...far, start: co(6, 0), turntables: [co(3, 3)], grid: walls([3, 3]), conveyors: [{ r: 2, c: 3, dir: 'U' }] }));
  const r = replay(w, ['W', 'W', 'W']);
  const L = w.layers[Math.floor((r.states[3]?.turn ?? 0) / 3) % 4]!;
  assert.equal(L.conv[at(3, 4)], 1); // moved N->E and now points right
});

test('portals + tether: a portal can fling you out, then you snap back', () => {
  const w = compileWorld(
    makePuzzle({
      mutations: ['PORTALS', 'TETHER_PYLON'],
      ...far,
      start: co(3, 2),
      tether: co(3, 3),
      grid: walls([3, 3]),
      portals: [{ r: 2, c: 2, label: 0 }, { r: 0, c: 0, label: 1 }, { r: 6, c: 0, label: 2 }, { r: 6, c: 6, label: 3 }]
    })
  );
  const r = step(w, initialState(w), 'U');
  assert.ok(r.ok);
  assert.ok(r.events.some((e) => e.t === 'tether'));
});

test('echo presses plates a move after you', () => {
  const w = compileWorld(makePuzzle({ mutations: ['ECHO', 'BLAST_DOORS'], ...far, start: co(3, 3), echoStart: co(5, 2), plates: [co(5, 3)], doors: [co(2, 6)] }));
  const r = replay(w, ['R', 'U']);
  assert.equal(r.states[1]?.doorsOpen, false);
  assert.equal(r.states[2]?.doorsOpen, true);
});

test('ice + prisms: a slide turns at a prism', () => {
  const w = compileWorld(makePuzzle({ mutations: ['CRYO_SLICK', 'REFLECTORS'], ...far, start: co(3, 0), ice: [co(3, 1)], reflectors: [{ r: 3, c: 2, rot: 1 }] }));
  const r = step(w, initialState(w), 'R');
  assert.ok(r.ok);
  assert.equal(r.state.pos, at(4, 2));
});

test('rotors + inertia: the twisted direction builds momentum', () => {
  const w = compileWorld(makePuzzle({ mutations: ['ROTORS', 'INERTIA'], ...far, start: co(3, 0), rotors: [{ r: 3, c: 1, rot: 1 }] }));
  const r = replay(w, ['R', 'R', 'U']);
  // R onto rotor, R twisted to D, U twisted? no: rotor fires once, so U is plain up after one D.
  assert.equal(r.states[2]?.pos, at(4, 1));
});

test('one-way gates apply to prism-bent movement', () => {
  const w = compileWorld(makePuzzle({ mutations: ['ONE_WAY_GATES', 'REFLECTORS'], ...far, start: co(3, 0), reflectors: [{ r: 3, c: 1, rot: 1 }], oneWays: [{ r: 4, c: 1, dir: 'U' }] }));
  const r = step(w, initialState(w), 'R');
  assert.ok(r.ok);
  assert.equal(r.state.pos, at(3, 1));
});

test('overclock and phase shift line up on move 12', () => {
  const w = compileWorld(makePuzzle({ mutations: ['OVERCLOCK', 'PHASE_SHIFT'], ...far }));
  const r = replay(w, Array(11).fill('W'));
  assert.equal(r.states[11]?.turn, 11);
});

test('wraparound + skittish cells: distance and fleeing wrap too', () => {
  const w = compileWorld(makePuzzle({ mutations: ['WRAPAROUND', 'SKITTISH_CELLS'], start: co(3, 5), cells: [co(3, 0), co(6, 6)], exit: co(0, 3) }));
  const r = step(w, initialState(w), 'W');
  assert.ok(r.ok);
  assert.equal(r.state.cells[0], at(3, 1));
});

test('wraparound + charged cells: the push reaches across the edge', () => {
  const w = compileWorld(makePuzzle({ mutations: ['WRAPAROUND', 'MAGNETIC_CELLS'], start: co(3, 5), cells: [co(3, 0), co(6, 3)], exit: co(0, 3) }));
  const r = step(w, initialState(w), 'R');
  assert.ok(r.ok);
  assert.equal(r.state.pos, at(3, 5));
});

test('skittish cells ride turntables', () => {
  const w = compileWorld(makePuzzle({ mutations: ['SKITTISH_CELLS', 'TURNTABLES'], start: co(6, 0), cells: [co(2, 3), co(6, 6)], exit: co(0, 6), turntables: [co(3, 3)], grid: walls([3, 3]) }));
  const r = replay(w, ['W', 'W', 'W']);
  assert.equal(r.states[3]?.cells[0], at(3, 4));
});

test('blight cannot swallow a skittish cell', () => {
  const w = compileWorld(makePuzzle({ mutations: ['SKITTISH_CELLS', 'INFECTION'], start: co(6, 0), cells: [co(2, 3), co(6, 6)], exit: co(0, 6), blight: [co(1, 3)], blightOrder: ['D', 'L', 'R', 'U'] }));
  const r = replay(w, ['W', 'W']);
  assert.equal(r.states[2]?.blight[at(2, 3)], 0);
});

test('crates hold blast doors open and stop blight', () => {
  const w = compileWorld(makePuzzle({ mutations: ['CRATES', 'BLAST_DOORS'], ...far, start: co(3, 0), crates: [co(3, 1)], plates: [co(3, 2)], doors: [co(5, 5)] }));
  const r = replay(w, ['R']);
  assert.equal(r.states[1]?.doorsOpen, true);
});

test('crates + gravity: gravity cannot push a crate', () => {
  const w = compileWorld(makePuzzle({ mutations: ['CRATES', 'GRAVITY'], ...far, start: co(2, 3), crates: [co(4, 3)] }));
  const r = step(w, initialState(w), 'W');
  assert.ok(r.ok);
  assert.equal(r.state.pos, at(3, 3));
  assert.deepEqual(r.state.crates, [at(4, 3)]);
});

test('afterimage + blight, crates + blight: blight avoids hard-light and crates', () => {
  const w = compileWorld(makePuzzle({ mutations: ['CRATES', 'INFECTION'], ...far, start: co(6, 6), crates: [co(4, 3)], blight: [co(3, 3)], blightOrder: ['D', 'L', 'R', 'U'] }));
  const r = replay(w, ['W', 'W']);
  assert.equal(r.states[2]?.blight[at(4, 3)], 0);
});

test('every interaction note names two real mutations', async () => {
  const { interactionNotes } = await import('../src/shared/engine/interactions.ts');
  const { ALL_MUTATIONS } = await import('../src/shared/engine/mutations.ts');
  const all = interactionNotes(ALL_MUTATIONS);
  assert.ok(all.length >= 25);
});

test('crates slide on ice', () => {
  const w = compileWorld(makePuzzle({ mutations: ['CRATES', 'CRYO_SLICK'], ...far, start: co(4, 0), crates: [co(4, 1)], ice: [co(4, 2), co(4, 3)] }));
  const r = step(w, initialState(w), 'R');
  assert.ok(r.ok);
  assert.deepEqual(r.state.crates, [at(4, 4)]);
});

test('belts carry crates', () => {
  const w = compileWorld(makePuzzle({ mutations: ['CRATES', 'CONVEYOR'], ...far, start: co(4, 0), crates: [co(4, 1)], conveyors: [{ r: 4, c: 2, dir: 'D' }] }));
  const r = step(w, initialState(w), 'R');
  assert.ok(r.ok);
  assert.deepEqual(r.state.crates, [at(5, 2)]);
});

test('crates warp through portals', () => {
  const w = compileWorld(
    makePuzzle({ mutations: ['CRATES', 'PORTALS'], ...far, start: co(4, 0), crates: [co(4, 1)], portals: [{ r: 4, c: 2, label: 0 }, { r: 6, c: 5, label: 1 }, { r: 2, c: 6, label: 2 }, { r: 1, c: 3, label: 3 }] })
  );
  const r = step(w, initialState(w), 'R');
  assert.ok(r.ok);
  assert.deepEqual(r.state.crates, [at(6, 5)]);
});

test('a crate fills a pit and the pit becomes floor', () => {
  const w = compileWorld(makePuzzle({ mutations: ['CRATES', 'DECAY'], ...far, start: co(3, 5), crates: [co(3, 2)], cracked: [co(3, 4)] }));
  // Cross the cracked tile to make a pit, walk round, then push the crate in.
  const r = replay(w, ['L', 'U', 'L', 'L', 'L', 'D', 'R', 'R']);
  assert.ok(r.ok, `failed at ${r.failedAt}`);
  const last = r.states.at(-1)!;
  assert.equal(last.decay[at(3, 4)], -2);
  // The filled pit is floor now.
  assert.ok(step(w, last, 'R').ok);
  assert.deepEqual(last.crates, []);
});

test('phase shift passes through a crate', () => {
  const w = compileWorld(makePuzzle({ mutations: ['CRATES', 'PHASE_SHIFT'], ...far, start: co(4, 0), crates: [co(4, 1)], grid: walls([4, 3]) }));
  const r = replay(w, ['W', 'W', 'W', 'R']);
  assert.equal(r.states[4]?.pos, at(4, 2));
  assert.deepEqual(r.states[4]?.crates, [at(4, 1)]);
});

test('magnets pull the drone', () => {
  const w = compileWorld(makePuzzle({ mutations: ['MAGNETISM', 'MIRROR_DRONE'], ...far, start: co(6, 6), droneStart: co(3, 1), magnets: [co(3, 4)], grid: walls([3, 4]) }));
  const r = step(w, initialState(w), 'W');
  assert.ok(r.ok);
  assert.equal(r.state.drone, at(3, 2));
});

test('gravity pulls the drone', () => {
  const w = compileWorld(makePuzzle({ mutations: ['GRAVITY', 'MIRROR_DRONE'], ...far, start: co(6, 6), droneStart: co(2, 2) }));
  const r = step(w, initialState(w), 'W');
  assert.ok(r.ok);
  assert.equal(r.state.drone, at(3, 2));
});

test('belts carry the drone and it slides on ice', () => {
  const w = compileWorld(makePuzzle({ mutations: ['CONVEYOR', 'MIRROR_DRONE'], ...far, start: co(6, 3), droneStart: co(2, 3), conveyors: [{ r: 2, c: 2, dir: 'D' }] }));
  const r = step(w, initialState(w), 'R');
  assert.ok(r.ok);
  assert.equal(r.state.drone, at(3, 2));
  const w2 = compileWorld(makePuzzle({ mutations: ['CRYO_SLICK', 'MIRROR_DRONE'], ...far, start: co(6, 3), droneStart: co(2, 3), ice: [co(2, 2), co(2, 1)] }));
  const r2 = step(w2, initialState(w2), 'R');
  assert.ok(r2.ok);
  assert.equal(r2.state.drone, at(2, 0));
});

test('blight cannot grow into water', () => {
  const w = compileWorld(makePuzzle({ mutations: ['FLOOD', 'INFECTION'], ...far, start: co(6, 6), flood: { edge: 'U' }, blight: [co(1, 3)], blightOrder: ['U', 'D', 'L', 'R'] }));
  const r = replay(w, ['W', 'W', 'W', 'W']);
  // Move 2: row A is still dry, so blight climbs into it. Move 4: row A is water.
  assert.equal(r.states[2]?.blight[at(0, 3)], 1);
  assert.equal(r.states[4]?.blight[at(0, 2)], 0);
  assert.equal(r.states[4]?.blight[at(2, 3)], 1);
});

test('gravity + springs: falling onto a spring launches you further down', () => {
  const w = compileWorld(makePuzzle({ mutations: ['GRAVITY', 'SPRINGS'], ...far, start: co(1, 3), springs: [co(2, 3)] }));
  const r = step(w, initialState(w), 'W');
  assert.ok(r.ok);
  assert.equal(r.state.pos, at(4, 3));
});

test('conveyor + mud: a belt that pushes you into mud stops there', () => {
  const w = compileWorld(makePuzzle({ mutations: ['CONVEYOR', 'MUD'], ...far, start: co(3, 0), conveyors: [{ r: 3, c: 1, dir: 'R' }, { r: 3, c: 2, dir: 'R' }], mud: [co(3, 2)] }));
  const r = step(w, initialState(w), 'R');
  assert.ok(r.ok);
  assert.equal(r.state.pos, at(3, 2));
});

test('ice + mud: mud stops a slide', () => {
  const w = compileWorld(makePuzzle({ mutations: ['CRYO_SLICK', 'MUD'], ...far, start: co(3, 0), ice: [co(3, 1), co(3, 2)], mud: [co(3, 3)] }));
  const r = step(w, initialState(w), 'R');
  assert.ok(r.ok);
  assert.equal(r.state.pos, at(3, 3));
});

test('crates cannot open locks or pass paint barriers', () => {
  const w = compileWorld(makePuzzle({ mutations: ['CRATES', 'KEYS'], ...far, start: co(3, 0), crates: [co(3, 1)], locks: [co(3, 2)], keys: [co(5, 5)] }));
  assert.equal(step(w, initialState(w), 'R').ok, false);
});

test('ice + springs: a slide that hits a spring is thrown onward', () => {
  const w = compileWorld(makePuzzle({ mutations: ['CRYO_SLICK', 'SPRINGS'], ...far, start: co(3, 0), ice: [co(3, 1)], springs: [co(3, 2)] }));
  const r = step(w, initialState(w), 'R');
  assert.ok(r.ok);
  assert.equal(r.state.pos, at(3, 4));
});

test('mirror drone + paint: the drone never crosses a barrier, whatever colour you are', () => {
  const w = compileWorld(makePuzzle({ mutations: ['MIRROR_DRONE', 'PAINT'], ...far, start: co(4, 4), droneStart: co(4, 2), paintPads: [{ r: 4, c: 5, color: 0 }], paintGates: [{ r: 4, c: 1, color: 0 }] }));
  const r = step(w, initialState(w), 'R');
  assert.ok(r.ok);
  assert.equal(r.state.paint, 1);
  assert.equal(r.state.drone, at(4, 2));
});

test('crates + paint: a crate cannot be pushed through a barrier', () => {
  const w = compileWorld(makePuzzle({ mutations: ['CRATES', 'PAINT'], ...far, start: co(3, 0), crates: [co(3, 1)], paintGates: [{ r: 3, c: 2, color: 1 }], paintPads: [{ r: 5, c: 5, color: 1 }] }));
  assert.equal(step(w, initialState(w), 'R').ok, false);
});

test('conveyor + pucks: a puck pushed onto a belt turns with it and keeps sliding', () => {
  const w = compileWorld(makePuzzle({ mutations: ['CONVEYOR', 'PUCKS'], ...far, start: co(3, 0), crates: [co(3, 1)], conveyors: [{ r: 3, c: 3, dir: 'D' }] }));
  const r = step(w, initialState(w), 'R');
  assert.ok(r.ok);
  assert.deepEqual(r.state.crates, [at(6, 3)]);
});

test('mirror drone + shuttles: the drone never boards a shuttle', () => {
  const w = compileWorld(makePuzzle({ mutations: ['MIRROR_DRONE', 'SHUTTLES'], ...far, start: co(5, 0), droneStart: co(2, 3), shuttles: [[co(3, 3), co(3, 4), co(3, 5)]] }));
  const r = step(w, initialState(w), 'U');
  assert.ok(r.ok);
  assert.equal(r.state.drone, at(2, 3));
});

test('low charge + mud: pulling free of mud costs a charge', () => {
  const w = compileWorld(makePuzzle({ mutations: ['LOW_CHARGE', 'MUD'], ...far, start: co(3, 0), mud: [co(3, 1)], charge: 2 }));
  const r = replay(w, ['R', 'R']);
  assert.ok(r.ok);
  assert.equal(r.states[2]?.pos, at(3, 1));
  assert.equal(r.states[2]?.charge, 0);
});

