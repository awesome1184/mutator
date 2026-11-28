import type { CSSProperties, ReactNode } from 'react';

// The move counter, printed on the bench like the scale on a pipette: one
// tick per move, par marked, and a pointer that slides along as you go.

type Props = {
  moves: number;
  par: number;
  /** Cells picked up, 0 to 2. */
  cells: number;
  children?: ReactNode;
};

export function Gauge({ moves, par, cells, children }: Props) {
  const span = Math.max(par + 6, moves + 3);
  const at = (n: number): CSSProperties => ({ left: `${(Math.min(n, span) / span) * 100}%` });
  const over = moves > par;
  return (
    <div className="gauge" aria-live="polite">
      <p className="gauge-count">
        <strong>{moves}</strong>
        <span>{moves === 1 ? 'move' : 'moves'}</span>
      </p>
      <div className={over ? 'gauge-scale over' : 'gauge-scale'} role="img" aria-label={`${moves} moves, par ${par}`}>
        {Array.from({ length: span + 1 }, (_, n) => (
          <i key={n} className={`g-tick${n % 5 === 0 ? ' major' : ''}${n === par ? ' par' : ''}${n > par ? ' past' : ''}`} style={at(n)} />
        ))}
        <i className="g-fill" style={{ width: `${(Math.min(moves, span) / span) * 100}%` }} />
        <span className="g-par" style={at(par)}>
          par {par}
        </span>
        <i className="g-pointer" style={at(moves)} />
      </div>
      <span className="gauge-cells" aria-label={`${cells} of 2 cells`}>
        {[0, 1].map((k) => (
          <svg key={k} width="14" height="21" viewBox="0 0 15 22" aria-hidden="true">
            <rect x="5" y="0.5" width="5" height="3" rx="1" className={k < cells ? 'cap got' : 'cap'} />
            <rect x="1.5" y="3" width="12" height="18" rx="3" className={k < cells ? 'cap got' : 'cap'} />
          </svg>
        ))}
        {children}
      </span>
    </div>
  );
}
