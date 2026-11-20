/** Bankroll's sounds, synthesised live with Web Audio: no audio files. */
export type Cue = 'roll' | 'step' | 'coin' | 'pay' | 'buy' | 'card' | 'jail' | 'build' | 'bid' | 'win' | 'bankrupt' | 'tap';

let ctx: AudioContext | null = null;
let muted = false;

export const setMuted = (m: boolean): void => {
  muted = m;
};
export const isMuted = (): boolean => muted;

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.12, slideTo?: number): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function clicks(n: number, gap: number): void {
  for (let i = 0; i < n; i++) tone(180 + ((i * 97) % 220), i * gap, 0.03, 'square', 0.05);
}

export function play(cue: Cue): void {
  switch (cue) {
    case 'roll':
      clicks(7, 0.045);
      break;
    case 'step':
      tone(660, 0, 0.05, 'triangle', 0.04);
      break;
    case 'coin':
      tone(988, 0, 0.08, 'triangle', 0.1);
      tone(1319, 0.07, 0.14, 'triangle', 0.1);
      break;
    case 'pay':
      tone(523, 0, 0.1, 'sine', 0.1, 392);
      break;
    case 'buy':
      [523, 659, 784].forEach((f, i) => tone(f, i * 0.06, 0.12, 'triangle', 0.09));
      break;
    case 'card':
      tone(300, 0, 0.25, 'sine', 0.08, 900);
      break;
    case 'jail':
      tone(392, 0, 0.18, 'sawtooth', 0.05, 196);
      tone(262, 0.16, 0.3, 'sine', 0.08, 131);
      break;
    case 'build':
      tone(440, 0, 0.06, 'square', 0.05);
      tone(880, 0.05, 0.1, 'triangle', 0.07);
      break;
    case 'bid':
      tone(740, 0, 0.06, 'triangle', 0.07);
      break;
    case 'win':
      [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.2, 'triangle', 0.1));
      break;
    case 'bankrupt':
      [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.14, 0.2, 'sine', 0.09));
      break;
    case 'tap':
      tone(880, 0, 0.03, 'sine', 0.04);
      break;
  }
}
