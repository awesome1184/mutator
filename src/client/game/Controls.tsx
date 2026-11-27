import type { ReactElement } from 'react';
import { rotateDir } from '../../shared/engine/grid.ts';
import type { Preview } from '../../shared/engine/forecast.ts';
import type { Action, Dir, GameState } from '../../shared/engine/types.ts';
import { isOverclock, isPhaseShift, type World } from '../../shared/engine/world.ts';
import { Arrow, HoldGlyph, RestartGlyph, UndoGlyph } from './icons.tsx';

type Props = {
  world: World;
  state: GameState;
  previews: Preview[];
  canUndo: boolean;
  disabled: boolean;
  onAction: (a: Action) => void;
  onUndo: () => void;
  onRestart: () => void;
  onFocus: (a: Action | null) => void;
};

const NAMES: Record<Action, string> = { U: 'Up', R: 'Right', D: 'Down', L: 'Left', W: 'Hold' };

export function Controls({ world, state, previews, canUndo, disabled, onAction, onUndo, onRestart, onFocus }: Props) {
  const rot = state.pendingRot;
  const surge = world.has.OVERCLOCK === true && isOverclock(state.turn);
  const ghost = world.has.PHASE_SHIFT === true && isPhaseShift(state.turn);

  const pad = (a: Dir): ReactElement => {
    const actual = rot ? rotateDir(a, rot) : a;
    const p = previews.find((x) => x.action === a);
    const double = surge || (world.has.INERTIA === true && state.inertia === actual);
    return (
      <button
        type="button"
        className={`pad pad-${a}${p && !p.ok ? ' blocked' : ''}`}
        disabled={disabled}
        onClick={() => onAction(a)}
        onPointerEnter={() => onFocus(a)}
        onPointerLeave={() => onFocus(null)}
        onFocus={() => onFocus(a)}
        onBlur={() => onFocus(null)}
        aria-label={`${NAMES[a]}${rot ? `, turns ${NAMES[actual].toLowerCase()}` : ''}${p && !p.ok ? ', blocked' : ''}`}
      >
        <Arrow dir={actual} size={26} weight={2.8} />
        {double && <span className="pad-badge">×2</span>}
      </button>
    );
  };

  return (
    <div className="controls">
      <div className="modifiers" aria-live="polite">
        {rot !== 0 && <span className="mod">Rotor: your next move turns {rot > 0 ? 'clockwise' : 'anticlockwise'}</span>}
        {surge && <span className="mod">This move goes 2 tiles</span>}
        {ghost && <span className="mod">This move can pass through a wall</span>}
      </div>
      <div className="pad-grid">
        {pad('U')}
        {pad('L')}
        <button
          type="button"
          className="pad pad-W"
          disabled={disabled}
          onClick={() => onAction('W')}
          onPointerEnter={() => onFocus('W')}
          onPointerLeave={() => onFocus(null)}
          onFocus={() => onFocus('W')}
          onBlur={() => onFocus(null)}
          aria-label="Hold for one move"
        >
          <HoldGlyph size={22} />
          <span className="pad-caption">hold</span>
        </button>
        {pad('R')}
        {pad('D')}
      </div>
      <div className="rewind">
        <button type="button" className="ghost-btn" onClick={onUndo} disabled={!canUndo || disabled} aria-label="Undo last move">
          <UndoGlyph />
          <span>Undo</span>
        </button>
        <button type="button" className="ghost-btn" onClick={onRestart} disabled={!canUndo || disabled} aria-label="Restart from the beginning">
          <RestartGlyph />
          <span>Restart</span>
        </button>
      </div>
    </div>
  );
}
