import type { ReactElement } from 'react';
import { forecast, type TurnInfo } from '../../shared/engine/forecast.ts';
import { MUTATIONS } from '../../shared/engine/mutations.ts';
import type { MutationId } from '../../shared/engine/types.ts';
import type { World } from '../../shared/engine/world.ts';
import { Arrow, MutationGlyph } from './icons.tsx';

const ROWS = 'ABCDEFG';

type Row = { id: MutationId; label: string; cell: (t: TurnInfo) => { text?: string | undefined; node?: ReactElement | undefined; on: boolean } };

const ROW_DEFS: Row[] = [
  { id: 'GRAVITY', label: 'Gravity', cell: (t) => ({ node: t.gravity ? <Arrow dir={t.gravity} size={15} /> : undefined, on: true }) },
  { id: 'OVERCLOCK', label: 'Double step', cell: (t) => ({ text: t.overclock ? '×2' : '', on: t.overclock }) },
  { id: 'PHASE_SHIFT', label: 'Walk through walls', cell: (t) => ({ text: t.phaseShift ? 'yes' : '', on: t.phaseShift }) },
  {
    id: 'PHASE_GATES',
    label: 'Closed gates',
    cell: (t) => ({ node: <span className={`gate-swatch g${t.closedGate}`} />, on: true })
  },
  { id: 'PORTALS', label: 'Pairs', cell: (t) => ({ text: t.portalMode === 0 ? 'AB CD' : 'AC BD', on: t.portalMode === 1 }) },
  {
    id: 'PULSE_BEAM',
    label: 'Beam',
    cell: (t) => ({ text: t.beam ? (t.beam.axis === 'row' ? ROWS[t.beam.index] : String(t.beam.index + 1)) : '', on: !!t.beam?.live })
  },
  { id: 'FLOOD', label: 'Water depth', cell: (t) => ({ text: String(t.flood), on: t.flood > 0 }) },
  { id: 'PHASE_LAYERS', label: 'Solid layer', cell: (t) => ({ text: t.phaseLayer === null ? '' : String(t.phaseLayer + 1), on: true }) },
  { id: 'VENTILATION', label: 'Vents', cell: (t) => ({ text: t.vents ? 'on' : 'off', on: !!t.vents }) },
  { id: 'TURNTABLES', label: 'Gears turn after', cell: (t) => ({ text: t.spinAfter ? '↻' : '', on: t.spinAfter }) },
  { id: 'INFECTION', label: 'Blight grows after', cell: (t) => ({ text: t.blightAfter ? '+1' : '', on: t.blightAfter }) }
];

export function Forecast({ world, turn, span = 6 }: { world: World; turn: number; span?: number }) {
  const rows = ROW_DEFS.filter((r) => world.has[r.id]);
  if (rows.length === 0) return null;
  const turns = forecast(world, turn, span);
  return (
    <table className="forecast" aria-label="What happens on your next moves">
      <thead>
        <tr>
          <th scope="col" className="fc-head">
            Move
          </th>
          {turns.map((t, k) => (
            <th key={t.turn} scope="col" className={k === 0 ? 'now' : undefined}>
              {t.turn + 1}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <th scope="row" style={{ color: MUTATIONS[r.id].ink }}>
              <MutationGlyph id={r.id} size={14} />
              <span>{r.label}</span>
            </th>
            {turns.map((t, k) => {
              const c = r.cell(t);
              return (
                <td key={t.turn} className={`${k === 0 ? 'now' : ''}${c.on ? ' on' : ''}`}>
                  {c.node ?? c.text}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
