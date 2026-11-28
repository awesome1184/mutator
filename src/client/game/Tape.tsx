import type { CSSProperties } from 'react';
import { MUTATIONS } from '../../shared/engine/mutations.ts';
import type { MutationId } from '../../shared/engine/types.ts';
import { MutationGlyph } from './icons.tsx';

// Strips of labelling tape stuck to the bench, one per mutation. Each strip
// sits at its own slight angle, the way tape never goes on straight.
const TILTS = [-1.6, 1.2, -0.6, 0.9];

type Props = {
  id: MutationId;
  index: number;
  voted?: boolean;
  /** Name only, no rule underneath (narrow screens). */
  compact?: boolean;
  onClick?: () => void;
};

export function Tape({ id, index, voted, compact, onClick }: Props) {
  const m = MUTATIONS[id];
  const style = {
    '--mut': m.ink,
    '--on-mut': m.darkText ? '#1d1b45' : '#fff',
    '--tilt': `${TILTS[index % TILTS.length]}deg`
  } as CSSProperties;
  const body = (
    <>
      <span className="tape-strip">
        <MutationGlyph id={id} size={17} />
        <span className="tape-name">{m.name}</span>
        {voted && <span className="tape-note">voted in</span>}
      </span>
      {!compact && <span className="tape-rule">{m.short}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className={compact ? 'tape compact' : 'tape'} style={style} onClick={onClick}>
      {body}
    </button>
  ) : (
    <span className={compact ? 'tape compact' : 'tape'} style={style}>
      {body}
    </span>
  );
}
