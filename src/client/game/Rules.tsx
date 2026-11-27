import { ALL_MUTATIONS, MUTATIONS } from '../../shared/engine/mutations.ts';
import type { MutationId, Puzzle } from '../../shared/engine/types.ts';
import { DIR_ARROW } from '../../shared/engine/grid.ts';
import { MutationGlyph } from './icons.tsx';

export function MutationCard({ id, puzzle }: { id: MutationId; puzzle?: Puzzle }) {
  const m = MUTATIONS[id];
  return (
    <article className="mut-card" style={{ ['--mut' as string]: m.ink }}>
      <header>
        <span className="mut-swatch" style={{ background: m.ink, color: m.darkText ? '#1d1b45' : '#fff' }}>
          <MutationGlyph id={id} size={20} />
        </span>
        <h3>{m.name}</h3>
      </header>
      <p>{m.rule}</p>
      {id === 'INFECTION' && puzzle && (
        <p className="mut-extra">Today’s spread order: {puzzle.blightOrder.map((d) => DIR_ARROW[d]).join(' ')}</p>
      )}
      <p className="mut-tip">{m.tip}</p>
    </article>
  );
}

export function Rules({ puzzle, seen }: { puzzle: Puzzle; seen: MutationId[] }) {
  return (
    <div className="rules">
      <section className="basics">
        <p className="lede">Pick up both cells, then reach the exit. Every day the rules change.</p>
        <ul className="plain-list">
          <li>Swipe on the board, tap a neighbouring well, or use the pad. Arrow keys and WASD work too, and space holds.</li>
          <li>Hold skips your move, but the world still takes its turn.</li>
          <li>Moves that would go nowhere are refused and cost nothing.</li>
          <li>Par is the shortest possible solution, worked out by a solver that checks every route.</li>
          <li>Your first solve of the day is the one that counts. Undo and restart are free, but the board keeps count of them.</li>
        </ul>
      </section>

      <h3 className="rules-sub">Today’s mutations</h3>
      <div className="mut-list">
        {puzzle.mutations.map((id) => (
          <MutationCard key={id} id={id} puzzle={puzzle} />
        ))}
      </div>

      <h3 className="rules-sub">Order of a move</h3>
      <ol className="turn-order">
        <li>You move.</li>
        <li>The echo repeats your previous move and the drone mirrors this one.</li>
        <li>The tile you landed on acts: portal, belt, vent, prism, rotor, then ice.</li>
        <li>Charged cells push or pull, then magnets pull.</li>
        <li>Gravity pulls.</li>
        <li>The tether snaps you back.</li>
        <li>The board updates: orbits, afterimage, cracks, blight, gears.</li>
      </ol>

      <h3 className="rules-sub">Catalogue</h3>
      <p className="muted">Mutations you have solved a puzzle with. {seen.length} of {ALL_MUTATIONS.length}.</p>
      <div className="catalogue">
        {ALL_MUTATIONS.map((id) => {
          const got = seen.includes(id);
          return (
            <span key={id} className={got ? 'cat got' : 'cat'} title={MUTATIONS[id].short} style={{ ['--mut' as string]: MUTATIONS[id].ink }}>
              <MutationGlyph id={id} size={16} />
              {MUTATIONS[id].name}
            </span>
          );
        })}
      </div>
    </div>
  );
}
