// Generates a run of daily puzzles and reports quality and timing.
// Usage: npm run audit:days -- [startDate] [days]
import { addDays, todayKey } from '../src/shared/engine/date.ts';
import { generateWithReport } from '../src/shared/engine/generator.ts';
import { compileWorld } from '../src/shared/engine/world.ts';
import { replay } from '../src/shared/engine/sim.ts';
import { parseActions } from '../src/shared/engine/grid.ts';
import { parRange } from '../src/shared/engine/generator.ts';
import { dayPlan } from '../src/shared/engine/schedule.ts';

const start = process.argv[2] ?? todayKey();
const days = Number(process.argv[3] ?? 28);
let d = start;
let relevant = 0;
let fallback = 0;
let inRange = 0;
let hard = 0;
let worst = 0;
let total = 0;
for (let i = 0; i < days; i++) {
  const t0 = performance.now();
  const rep = generateWithReport(d);
  const ms = performance.now() - t0;
  total += ms;
  worst = Math.max(worst, ms);
  const p = rep.puzzle;
  const w = compileWorld(p);
  const r = replay(w, parseActions(p.solution ?? '') ?? []);
  if (!r.solved || r.solvedAt !== p.par) throw new Error(`${d}: stored solution does not replay to par`);
  const [lo, hi] = parRange(dayPlan(d).tier, p.mutations);
  const ok = p.par >= lo && p.par <= hi;
  if (rep.relevant) relevant++;
  if (rep.fallback) fallback++;
  if (ok) inRange++;
  if (rep.hard) hard++;
  console.log(
    `${d} ${p.tier.padEnd(8)} ${p.mutations.join('+').padEnd(42)} par ${String(p.par).padStart(2)} [${lo}-${hi}] ${rep.relevant ? 'relevant' : '--------'} gap ${rep.gap >= 99 ? 'stuck' : String(rep.gap).padStart(5)}/${dayPlan(d).tier.gap} ${rep.hard ? '    ' : 'EASY'} ${rep.fallback ? 'FALLBACK' : ''} ${ms.toFixed(0).padStart(5)}ms`
  );
  d = addDays(d, 1);
}
console.log(`\n${days} days: relevant ${relevant}, hard enough ${hard}, in range ${inRange}, fallback ${fallback}, avg ${(total / days).toFixed(0)}ms, worst ${worst.toFixed(0)}ms`);
