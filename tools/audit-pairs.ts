// Generates a board for every mutation pair and reports failures.
// Usage: node --experimental-strip-types tools/audit-pairs.ts [date]
import { generateWithReport } from '../src/shared/engine/generator.ts';
import { ALL_MUTATIONS } from '../src/shared/engine/mutations.ts';
import type { MutationId } from '../src/shared/engine/types.ts';

const date = process.argv[2] ?? '2026-12-02';
let n = 0;
let bad = 0;
let irrelevant = 0;
let worst = 0;
const singles = process.argv.includes('--singles');
const combos: MutationId[][] = [];
if (singles) for (const a of ALL_MUTATIONS) combos.push([a]);
else for (let i = 0; i < ALL_MUTATIONS.length; i++) for (let j = i + 1; j < ALL_MUTATIONS.length; j++) combos.push([ALL_MUTATIONS[i]!, ALL_MUTATIONS[j]!]);
for (const combo of combos) {
  const t0 = performance.now();
  const rep = generateWithReport(date, { mutations: combo });
  const ms = performance.now() - t0;
  worst = Math.max(worst, ms);
  n++;
  if (!rep.relevant) irrelevant++;
  if (rep.fallback || rep.puzzle.par < 4) {
    bad++;
    console.log('BAD', combo.join('+'), rep.puzzle.mutations.join('+'), 'par', rep.puzzle.par, rep.fallback ? 'fallback' : '');
  } else if (!rep.relevant) {
    console.log('meh', combo.join('+'), 'par', rep.puzzle.par);
  }
}
console.log(`${n} combos, bad ${bad}, not-all-relevant ${irrelevant}, worst ${worst.toFixed(0)}ms`);
