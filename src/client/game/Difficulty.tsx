// Difficulty as a row of five tiny wells, filled from the left.

const TIER_LEVEL: Record<string, number> = { warmup: 1, standard: 2, tricky: 3, hard: 4, expert: 5, anomaly: 5 };

export function Difficulty({ tier, label }: { tier: string; label: string }) {
  const level = TIER_LEVEL[tier] ?? 1;
  return (
    <span className="difficulty" title={label}>
      <svg width="46" height="9" viewBox="0 0 46 9" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((k) => (
          <circle key={k} cx={4.5 + k * 9.2} cy="4.5" r="3.4" className={k < level ? 'dw on' : 'dw'} />
        ))}
      </svg>
      <span>{label.toLowerCase()}</span>
    </span>
  );
}
