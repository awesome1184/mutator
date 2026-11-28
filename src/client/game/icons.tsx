import type { ReactElement } from 'react';
import type { Dir, MutationId } from '../../shared/engine/types.ts';

// Hand-drawn 24×24 glyphs. Stroke uses currentColor so they take any ink.

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const GLYPHS: Record<MutationId, ReactElement> = {
  GRAVITY: (
    <g {...P}>
      <path d="M12 3v13M7 11l5 5 5-5" />
      <path d="M5 21h14" />
    </g>
  ),
  DECAY: (
    <g {...P}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M12 4l-2 5 4 3-3 4 1 4M10 9l-5 1M14 12l5-2" />
    </g>
  ),
  INFECTION: (
    <g {...P}>
      <circle cx="9" cy="10" r="4.5" />
      <circle cx="16" cy="14" r="3.5" />
      <circle cx="9.5" cy="18" r="2" />
    </g>
  ),
  CONVEYOR: (
    <g {...P}>
      <path d="M4 7l5 5-5 5M11 7l5 5-5 5M18 7l3 5-3 5" />
    </g>
  ),
  PORTALS: (
    <g {...P}>
      <ellipse cx="7" cy="12" rx="3.5" ry="7" />
      <ellipse cx="17" cy="12" rx="3.5" ry="7" />
      <path d="M10.5 12h3" strokeDasharray="1 2" />
    </g>
  ),
  PHASE_GATES: (
    <g {...P}>
      <path d="M7 3v18M17 3v18" />
      <path d="M7 3v18" strokeWidth="4" />
      <path d="M17 3v18" strokeDasharray="2 3" />
    </g>
  ),
  CRYO_SLICK: (
    <g {...P}>
      <path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9" />
      <path d="M10 5l2 2 2-2M10 19l2-2 2 2" />
    </g>
  ),
  OVERCLOCK: (
    <g {...P}>
      <path d="M13 3L6 13h6l-1 8 7-10h-6z" />
    </g>
  ),
  MAGNETISM: (
    <g {...P}>
      <path d="M6 4v8a6 6 0 0012 0V4" />
      <path d="M6 7h3M15 7h3" strokeWidth="3" />
    </g>
  ),
  MIRROR_DRONE: (
    <g {...P}>
      <path d="M12 3l6 9-6 9-6-9z" />
      <path d="M12 3v18" strokeDasharray="2 2.5" />
    </g>
  ),
  PHASE_SHIFT: (
    <g {...P}>
      <rect x="9" y="4" width="6" height="16" rx="1" strokeDasharray="2.5 2.5" />
      <path d="M3 12h18M17 8l4 4-4 4" />
    </g>
  ),
  PAYLOAD_MASS: (
    <g {...P}>
      <path d="M9 7a3 3 0 016 0" />
      <path d="M6 9h12l2 11H4z" />
    </g>
  ),
  AFTERIMAGE: (
    <g {...P}>
      <rect x="3" y="8" width="11" height="11" rx="2" strokeDasharray="2.5 2.5" />
      <rect x="10" y="4" width="11" height="11" rx="2" />
    </g>
  ),
  MAGNETIC_CELLS: (
    <g {...P}>
      <circle cx="7.5" cy="12" r="4.5" />
      <circle cx="16.5" cy="12" r="4.5" />
      <path d="M5.5 12h4M7.5 10v4M14.5 12h4" />
    </g>
  ),
  TURNTABLES: (
    <g {...P}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3v3M21 12h-3M12 21v-3M3 12h3" />
      <path d="M17 5.5a9 9 0 011.5 1.5" />
      <path d="M18.5 4.5l.2 3-3 .2" />
    </g>
  ),
  TETHER_PYLON: (
    <g {...P}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" strokeDasharray="3 2.5" />
      <circle cx="12" cy="12" r="2.5" />
    </g>
  ),
  BLAST_DOORS: (
    <g {...P}>
      <rect x="5" y="3" width="14" height="13" rx="1.5" />
      <path d="M12 3v13M8 7v2M16 7v2" />
      <path d="M7 20h10" strokeWidth="3" />
    </g>
  ),
  REFLECTORS: (
    <g {...P}>
      <path d="M5 19L19 5" strokeWidth="3" />
      <path d="M3 12h7v-7" />
      <path d="M8 7l2-2 2 2" />
    </g>
  ),
  ECHO: (
    <g {...P}>
      <path d="M8 20v-8a6 6 0 0112 0v8l-2-2-2 2-2-2-2 2-2-2z" />
      <path d="M4 9a8 8 0 00-1 4M5.5 5.5A9 9 0 004 8" />
    </g>
  ),
  ONE_WAY_GATES: (
    <g {...P}>
      <path d="M3 12h14M13 7l5 5-5 5" />
      <path d="M21 5v14" />
    </g>
  ),
  ORBITAL_CELLS: (
    <g {...P}>
      <circle cx="12" cy="12" r="7.5" strokeDasharray="3 3" />
      <circle cx="12" cy="4.5" r="2.5" fill="currentColor" />
    </g>
  ),
  PULSE_BEAM: (
    <g {...P}>
      <path d="M2 12h5l2-5 3 10 3-10 2 5h5" />
    </g>
  ),
  VENTILATION: (
    <g {...P}>
      <path d="M3 8c3-2 5 2 8 0s5-2 8 0M3 13c3-2 5 2 8 0s5-2 8 0M3 18c3-2 5 2 8 0s5-2 8 0" />
    </g>
  ),
  INERTIA: (
    <g {...P}>
      <path d="M9 12h12M17 8l4 4-4 4" />
      <path d="M3 8h5M2 12h4M3 16h5" />
    </g>
  ),
  FLOOD: (
    <g {...P}>
      <path d="M3 9c2-2 4 2 6 0s4-2 6 0 4 2 6 0" />
      <path d="M3 15c2-2 4 2 6 0s4-2 6 0 4 2 6 0" />
      <path d="M3 21h18" />
    </g>
  ),
  PHASE_LAYERS: (
    <g {...P}>
      <rect x="3" y="3" width="11" height="11" rx="1.5" />
      <rect x="10" y="10" width="11" height="11" rx="1.5" strokeDasharray="2.5 2.5" />
      <path d="M5 11l6-6M5 7l2-2" />
    </g>
  ),
  ROTORS: (
    <g {...P}>
      <path d="M19 12a7 7 0 11-3-5.7" />
      <path d="M16.5 2.5l-.5 4 4 .5" />
    </g>
  ),
  WRAPAROUND: (
    <g {...P}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
      <path d="M2 12h3M19 12h3M20 9.5l2 2.5-2 2.5M4 9.5L2 12l2 2.5" />
    </g>
  ),
  SKITTISH_CELLS: (
    <g {...P}>
      <rect x="13" y="7" width="7" height="12" rx="2" />
      <path d="M15 5h3" />
      <path d="M3 10h6M2 14h6M4 18h5" />
    </g>
  ),
  CRATES: (
    <g {...P}>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M4 4l16 16M20 4L4 20" />
    </g>
  ),
  SPRINGS: (
    <g {...P}>
      <path d="M5 20h14M7 16l10-2-10-2 10-2-10-2" />
      <path d="M6 5h12" />
    </g>
  ),
  PAINT: (
    <g {...P}>
      <path d="M10 3c3 4 5 7 5 10a5 5 0 01-10 0c0-3 2-6 5-10z" />
      <path d="M17 11c1.5 2 2.5 3.5 2.5 5a2.5 2.5 0 01-5 0" />
    </g>
  ),
  KEYS: (
    <g {...P}>
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h9M18 12v3M21 12v2" />
    </g>
  ),
  MUD: (
    <g {...P}>
      <path d="M3 17c0-2 3-3 6-3 1-1 5-1 7 0 3 0 5 1 5 3s-4 3-9 3-9-1-9-3z" />
      <path d="M9 9a2 2 0 100-.01M15 6a1.5 1.5 0 100-.01" />
    </g>
  ),
  PUCKS: (
    <g {...P}>
      <ellipse cx="14" cy="14" rx="7" ry="3.5" />
      <path d="M7 14v2.5c0 2 3 3.5 7 3.5s7-1.5 7-3.5V14" />
      <path d="M2 9h6M3 5.5h5" />
    </g>
  ),
  SHUTTLES: (
    <g {...P}>
      <path d="M3 19h18" strokeDasharray="2 3" />
      <rect x="7" y="9" width="10" height="6" rx="1.5" />
      <path d="M4 12l2-2M4 12l2 2M20 12l-2-2M20 12l-2 2" />
    </g>
  ),
  HATCHES: (
    <g {...P}>
      <circle cx="7" cy="16" r="4" />
      <circle cx="17" cy="8" r="4" />
      <path d="M10 13l4-3" strokeDasharray="1.5 2.5" />
    </g>
  ),
  LOW_CHARGE: (
    <g {...P}>
      <rect x="3" y="7" width="16" height="10" rx="2" />
      <path d="M21 10.5v3M6.5 10v4" />
    </g>
  )
};

export function MutationGlyph({ id, size = 20 }: { id: MutationId; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {GLYPHS[id]}
    </svg>
  );
}

const ROT: Record<Dir, number> = { U: 0, R: 90, D: 180, L: 270 };

export function Arrow({ dir, size = 18, weight = 2.4 }: { dir: Dir; size?: number; weight?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${ROT[dir]}deg)` }}>
      <path d="M12 20V5M6 11l6-6 6 6" fill="none" stroke="currentColor" strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HoldGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 6v12M15 6v12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function UndoGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 14L4 9l5-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 9h10a6 6 0 010 12h-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function RestartGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 12a8 8 0 108-8H8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M10 1L7 4l3 3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SoundGlyph({ on, size = 18 }: { on: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      {on ? (
        <path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      ) : (
        <path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}
