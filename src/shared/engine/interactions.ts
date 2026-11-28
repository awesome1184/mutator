// Notes on how pairs of mutations combine. Every note here is backed by a
// test in tests/synergy.test.ts.
import type { MutationId } from './types.ts';

const NOTES: Record<string, string> = {
  'CONVEYOR+GRAVITY': 'A belt pushes you first, then gravity pulls, so one move can carry you diagonally.',
  'GRAVITY+PORTALS': 'Gravity acts after a warp, so you are pulled off the exit pad straight away.',
  'CRYO_SLICK+PORTALS': 'Slide into a pad and you warp, then stop on the far pad. Pads are not ice.',
  'DECAY+GRAVITY': 'Being pulled off a cracked tile breaks it, just like walking off it.',
  'GRAVITY+PAYLOAD_MASS': 'With no cells you fall 2 tiles, with one cell 1 tile, and with both cells not at all.',
  'CONVEYOR+PAYLOAD_MASS': 'Belts push you 2 tiles with no cells, 1 with one cell, and not at all with both.',
  'MAGNETISM+PAYLOAD_MASS': 'Carrying both cells makes you too heavy for magnets.',
  'BLAST_DOORS+MIRROR_DRONE': 'The drone presses plates too, so it can open doors on the far side.',
  'INFECTION+MIRROR_DRONE': 'Blight cannot grow onto the drone. Park it on the marked tile.',
  'AFTERIMAGE+CRYO_SLICK': 'Hard-light stops slides, so your own trail can act as a brake.',
  'AFTERIMAGE+INFECTION': 'Blight cannot grow onto hard-light.',
  'OVERCLOCK+PHASE_SHIFT': 'Move 12 is both a double step and a phase move. Phasing ends the move.',
  'CONVEYOR+TURNTABLES': 'Belts next to a gear rotate with it, arrows and all.',
  'PHASE_GATES+TURNTABLES': 'Gates next to a gear rotate with it and keep their colour.',
  'PORTALS+TETHER_PYLON': 'A portal can drop you outside the zone, and you snap back 1 tile at the end of the move.',
  'CONVEYOR+TETHER_PYLON': 'Belts can carry you outside the zone before the leash snaps you back.',
  'MAGNETIC_CELLS+MAGNETISM': 'Cells push or pull first, then magnets pull. Two shoves in one move.',
  'BLAST_DOORS+ECHO': 'The echo presses plates one move after you, which is a delayed switch.',
  'CRYO_SLICK+REFLECTORS': 'A slide that hits a prism turns 90° and carries on.',
  'INERTIA+ROTORS': 'Momentum follows the direction you actually moved, after the rotor twist.',
  'ONE_WAY_GATES+REFLECTORS': 'A prism-bent move still has to match the gate’s arrow.',
  'MAGNETIC_CELLS+WRAPAROUND': 'Charged cells reach across the edges.',
  'SKITTISH_CELLS+WRAPAROUND': 'There are no corners. Cells flee across the edges, so trap them against walls.',
  'SKITTISH_CELLS+TURNTABLES': 'A cell on a gear’s ring rides it round.',
  'INFECTION+SKITTISH_CELLS': 'Blight never grows onto a cell.',
  'BLAST_DOORS+CRATES': 'Push a crate onto a plate to press it, and a crate in a doorway keeps that door from closing.',
  'CRATES+GRAVITY': 'Gravity cannot move crates, so a crate makes a solid floor to land on.',
  'CRATES+SKITTISH_CELLS': 'Crates block a fleeing cell. Use them to build a corner.',
  'CRATES+INFECTION': 'Blight cannot grow onto a crate.',
  'CRATES+CRYO_SLICK': 'A crate pushed onto ice slides until something stops it.',
  'CONVEYOR+CRATES': 'Push a crate onto a belt and the belt carries it along.',
  'CRATES+PORTALS': 'A crate pushed onto a pad warps to its partner, if the partner pad is free.',
  'CRATES+DECAY': 'Push a crate into a pit to fill it. The pit becomes solid floor for good.',
  'CRATES+PHASE_SHIFT': 'On a phase move you can step straight through a crate.',
  'MAGNETISM+MIRROR_DRONE': 'Magnets pull the drone too. It is made of metal.',
  'GRAVITY+MIRROR_DRONE': 'Gravity pulls the drone 1 tile after it moves.',
  'CONVEYOR+MIRROR_DRONE': 'Belts carry the drone.',
  'CRYO_SLICK+MIRROR_DRONE': 'The drone slides on ice too.',
  'FLOOD+INFECTION': 'Blight cannot grow into water.',
  'CRATES+TURNTABLES': 'A crate on a gear’s ring rides it round.',
  'GRAVITY+SPRINGS': 'Falling onto a spring counts, so gravity can throw you 2 more tiles down.',
  'CRYO_SLICK+SPRINGS': 'A slide that reaches a spring is thrown 2 tiles further.',
  'CONVEYOR+MUD': 'A belt that carries you into mud stops there.',
  'CRYO_SLICK+MUD': 'Mud stops a slide dead.',
  'GRAVITY+MUD': 'While you are stuck in mud, gravity can’t pull you.',
  'CRATES+KEYS': 'A crate can’t go into a lock until you have opened it.',
  'CRATES+PAINT': 'Crates never pass paint barriers.',
  'MIRROR_DRONE+PAINT': 'The drone never passes paint barriers, whatever colour you are.'
};

export function interactionNotes(muts: readonly MutationId[]): { pair: [MutationId, MutationId]; text: string }[] {
  const out: { pair: [MutationId, MutationId]; text: string }[] = [];
  for (let i = 0; i < muts.length; i++) {
    for (let j = i + 1; j < muts.length; j++) {
      const a = muts[i] as MutationId;
      const b = muts[j] as MutationId;
      const key = [a, b].sort().join('+');
      const text = NOTES[key];
      if (text) out.push({ pair: [a, b], text });
    }
  }
  return out;
}
