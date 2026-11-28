/** The wordmark with one letter "mutated" each day. */
export function Wordmark({ number, ink }: { number: number; ink: string }) {
  const letters = 'MUTATOR'.split('');
  const k = number % letters.length;
  const twist = ['rotate(-12deg)', 'translateY(3px) rotate(8deg)', 'skewX(-14deg)', 'scaleY(0.8) translateY(2px)'][number % 4];
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

