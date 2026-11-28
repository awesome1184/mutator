// How hard is each mutation pairing for a player who doesn't plan ahead?
//   node --experimental-strip-types tools/audit-difficulty.ts 2026-12-05 [MUT ...]
// With no mutations listed it runs every single mutation and every pair the
// schedule can produce. "difficulty" is the score from
// src/shared/engine/difficulty.ts; "EASY" means below the day's target.
import { generateWithReport } from '../src/shared/engine/generator.ts';
import { ALL_MUTATIONS } from '../src/shared/engine/mutations.ts';
import { dayPlan, isMild } from '../src/shared/engine/schedule.ts';
import type { MutationId } from '../src/shared/engine/types.ts';

const date = process.argv[2] ?? '2026-12-05';
const only = process.argv.slice(3) as MutationId[];
const combos: MutationId[][] = [];
if (only.length) combos.push(only);
else {
  for (const a of ALL_MUTATIONS) combos.push([a]);
  for (let i = 0; i < ALL_MUTATIONS.length; i++)
    for (let j = i + 1; j < ALL_MUTATIONS.length; j++) {
      const a = ALL_MUTATIONS[i] as MutationId;
      const b = ALL_MUTATIONS[j] as MutationId;
      if (isMild(a) && isMild(b)) continue;
      combos.push([a, b]);
    }
}
const target = dayPlan(date).tier.difficulty;
const gaps: number[] = [];
let easy = 0;
let irrelevant = 0;
let worst = 0;
for (const muts of combos) {
  const t0 = performance.now();
  const r = generateWithReport(date, { mutations: muts });
  const ms = performance.now() - t0;
  worst = Math.max(worst, ms);
  gaps.push(r.difficulty);
  if (!r.hard) easy++;
  if (!r.relevant) irrelevant++;
  const gap = String(r.difficulty);
  console.log(
    `${muts.join('+').padEnd(36)} par ${String(r.puzzle.par).padStart(2)}  difficulty ${gap.padStart(2)}  ${r.hard ? '    ' : 'EASY'} ${r.relevant ? '          ' : 'IRRELEVANT'} ${ms.toFixed(0)}ms`
  );
}
gaps.sort((a, b) => a - b);
const pct = (q: number): number => gaps[Math.floor((gaps.length - 1) * q)] as number;
console.log(
  `\n${combos.length} combos, target difficulty ${target}. Easy: ${easy}. Irrelevant: ${irrelevant}. Difficulty quartiles: ${pct(0.25)} / ${pct(0.5)} / ${pct(0.75)}. Slowest: ${worst.toFixed(0)}ms`
);
