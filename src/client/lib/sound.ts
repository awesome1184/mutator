// Small synthesized sound set. Silent until the first user gesture, mutable,
// and muted automatically when the page is hidden.

import { load, save } from './storage.ts';

type Cue = 'step' | 'bump' | 'cell' | 'warp' | 'push' | 'fall' | 'door' | 'crack' | 'win' | 'undo' | 'spring' | 'unlock' | 'squelch';

let ctx: AudioContext | null = null;
let muted = load<boolean>('mutator-muted', false);
let hidden = false;

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    if (hidden) void ctx?.suspend();
    else if (!muted) void ctx?.resume();
  });
}

function audio(): AudioContext | null {
  if (muted || hidden) return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function blip(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export function play(cue: Cue): void {
  switch (cue) {
    case 'step':
      blip(392, 0.06, 'triangle', 0.05, 440);
      break;
    case 'bump':
      blip(140, 0.09, 'square', 0.03, 110);
      break;
    case 'cell':
      blip(660, 0.09, 'sine', 0.08, 990);
      blip(990, 0.12, 'sine', 0.06, 1320, 0.07);
      break;
    case 'warp':
      blip(300, 0.16, 'sine', 0.06, 900);
      break;
    case 'push':
      blip(260, 0.07, 'triangle', 0.04, 330);
      break;
    case 'fall':
      blip(330, 0.1, 'triangle', 0.04, 200);
      break;
    case 'door':
      blip(180, 0.12, 'square', 0.03, 260);
      break;
    case 'crack':
      blip(220, 0.1, 'sawtooth', 0.025, 90);
      break;
    case 'spring':
      blip(240, 0.14, 'sine', 0.06, 720);
      break;
    case 'unlock':
      blip(520, 0.05, 'square', 0.025, 520);
      blip(780, 0.08, 'triangle', 0.04, 780, 0.05);
      break;
    case 'squelch':
      blip(120, 0.14, 'sine', 0.06, 70);
      break;
    case 'undo':
      blip(440, 0.05, 'triangle', 0.03, 330);
      break;
    case 'win':
      [523, 659, 784, 1046].forEach((f, i) => blip(f, 0.22, 'triangle', 0.07, undefined, i * 0.08));
      break;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  save('mutator-muted', m);
  if (m) void ctx?.suspend();
}
