/**
 * The wordmark with one letter "mutated": the letter matches the weekday,
 * M on Monday through R on Sunday.
 */
export function Wordmark({ weekday, ink }: { weekday: number; ink: string }) {
  const letters = 'MUTATOR'.split('');
  // weekday is 0 = Sunday … 6 = Saturday; Monday is the first letter.
  const k = (weekday + 6) % 7;
  const twist = ['rotate(-12deg)', 'translateY(3px) rotate(8deg)', 'skewX(-14deg)', 'scaleY(0.8) translateY(2px)'][k % 4];
  return (
    <h1 className="wordmark" aria-label="MUTATOR">
      {letters.map((ch, i) => (
        <span key={i} className={i === k ? 'mutated' : undefined} style={i === k ? { color: ink, transform: twist } : undefined} aria-hidden="true">
          {ch}
        </span>
      ))}
    </h1>
  );
}
