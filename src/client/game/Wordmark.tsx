/**
 * The wordmark with one letter "mutated": the letter matches the weekday,
 * M on Monday through R on Sunday.
 */
/** Lighten a colour until it stands out against the blue bench. */
function legible(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  let [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = (): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  for (let k = 0; k < 6 && lum() < 0.5; k++) {
    r = Math.round(r + (255 - r) * 0.3);
    g = Math.round(g + (255 - g) * 0.3);
    b = Math.round(b + (255 - b) * 0.3);
  }
  return `rgb(${r} ${g} ${b})`;
}

export function Wordmark({ weekday, ink }: { weekday: number; ink: string }) {
  const letters = 'MUTATOR'.split('');
  // weekday is 0 = Sunday … 6 = Saturday; Monday is the first letter.
  const k = (weekday + 6) % 7;
  const twist = ['rotate(-12deg)', 'translateY(3px) rotate(8deg)', 'skewX(-14deg)', 'scaleY(0.8) translateY(2px)'][k % 4];
  return (
    <h1 className="wordmark" aria-label="MUTATOR">
      {letters.map((ch, i) => (
        <span key={i} className={i === k ? 'mutated' : undefined} style={i === k ? { color: legible(ink), transform: twist } : undefined} aria-hidden="true">
          {ch}
        </span>
      ))}
    </h1>
  );
}
