import { ALL_MUTATIONS, MUTATIONS } from '../../shared/engine/mutations.ts';
import type { MutationId, Puzzle } from '../../shared/engine/types.ts';
import { DIR_ARROW } from '../../shared/engine/grid.ts';
import { interactionNotes } from '../../shared/engine/interactions.ts';
import { Tape } from './Tape.tsx';

export function Rules({ puzzle, seen }: { puzzle: Puzzle; seen: MutationId[] }) {
  const notes = interactionNotes(puzzle.mutations);
  return (
    <div className="rules">
      <p className="lede">Pick up both cells, then reach the exit. The rules change every day. Par is the fewest moves it can be done in.</p>

      <h3>Today</h3>
      {puzzle.mutations.map((id, k) => (
        <section className="rule" key={id}>
          <Tape id={id} index={k} compact voted={puzzle.communityPick === id} />
          <p>{MUTATIONS[id].rule}</p>
          {id === 'INFECTION' && <p>Today it spreads in this order: {puzzle.blightOrder.map((d) => DIR_ARROW[d]).join(' ')}</p>}
          <p className="tip">{MUTATIONS[id].tip}</p>
        </section>
      ))}

      {notes.length > 0 && (
        <>
          <h3>Together</h3>
          <ul className="notes">
            {notes.map((n) => (
              <li key={n.pair.join('+')}>
                <b>
                  {MUTATIONS[n.pair[0]].name} and {MUTATIONS[n.pair[1]].name}.
                </b>{' '}
                {n.text}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Playing</h3>
      <dl className="keys">
        <dt>Move</dt>
        <dd>Swipe the plate, tap a well next to you, or use the keypad. Arrow keys and WASD work too.</dd>
        <dt>Hold</dt>
        <dd>Space, or the middle key. You stay put and the board still takes its turn.</dd>
        <dt>Undo</dt>
        <dd>Z, and R to restart. Both are free, but the scores count them.</dd>
        <dt>Look</dt>
        <dd>Hover over a well, or press and hold one, to read what is in it.</dd>
      </dl>
      <p>A move that would go nowhere is refused and costs nothing. Your first solve of the day is the one that counts.</p>

      <h3>Order of a move</h3>
      <ol className="turn-order">
        <li>You move.</li>
        <li>The echo repeats your previous move and the drone mirrors this one.</li>
        <li>The well you landed on acts: portal, belt, vent, prism, rotor, spring, then ice.</li>
        <li>Charged cells push or pull, then magnets pull.</li>
        <li>Gravity pulls, and the tether snaps you back.</li>
        <li>The board moves on: orbits, afterimage, cracks, blight, gears, shuttles, then the exit hatch.</li>
      </ol>

      <h3>Catalogue</h3>
      <p className="small muted">
        Mutations you have solved a puzzle with: {seen.length} of {ALL_MUTATIONS.length}.
      </p>
      <ul className="catalogue">
        {ALL_MUTATIONS.map((id) => (
          <li key={id} className={seen.includes(id) ? 'got' : undefined} title={MUTATIONS[id].short}>
            <i style={{ background: MUTATIONS[id].ink }} />
            {MUTATIONS[id].name}
          </li>
        ))}
      </ul>
    </div>
  );
}
