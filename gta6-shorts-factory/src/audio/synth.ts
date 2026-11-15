/**
 * Original procedural music + sound effects. Everything here is synthesized from
 * scratch (oscillators, filtered noise), so the output carries no third-party
 * rights and is safe for commercial use. Deterministic for a given seed.
 */

export const SR = 48000;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

class Biquad {
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  private b0 = 0; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  constructor(type: "lp" | "hp" | "bp", freq: number, q = 0.707) { this.set(type, freq, q); }
  set(type: "lp" | "hp" | "bp", freq: number, q = 0.707) {
    const w = (2 * Math.PI * Math.min(freq, SR * 0.45)) / SR;
    const c = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q), a0 = 1 + al;
    if (type === "lp") { this.b0 = (1 - c) / 2; this.b1 = 1 - c; this.b2 = (1 - c) / 2; }
    else if (type === "hp") { this.b0 = (1 + c) / 2; this.b1 = -(1 + c); this.b2 = (1 + c) / 2; }
    else { this.b0 = al; this.b1 = 0; this.b2 = -al; }
    this.b0 /= a0; this.b1 /= a0; this.b2 /= a0; this.a1 = (-2 * c) / a0; this.a2 = (1 - al) / a0;
  }
  run(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
const saw = (ph: number) => 2 * (ph - Math.floor(ph + 0.5));
const tri = (ph: number) => 1 - 4 * Math.abs(Math.round(ph - 0.25) - (ph - 0.25));

/** Simple stereo feedback delay/reverb-ish tail. */
function addEcho(L: Float32Array, R: Float32Array, delaySec: number, fb: number, mix: number) {
  const d = Math.round(delaySec * SR);
  const bl = new Float32Array(L.length), br = new Float32Array(R.length);
  for (let i = 0; i < L.length; i++) {
    const il = i >= d ? br[i - d] : 0; // ping-pong
    const ir = i >= d ? bl[i - d] : 0;
    bl[i] = L[i] + il * fb;
    br[i] = R[i] + ir * fb;
    L[i] += il * mix;
    R[i] += ir * mix;
  }
}

function normalizePeak(chs: Float32Array[], peak = 0.89) {
  let m = 0;
  for (const c of chs) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i]));
  if (m > 0) for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= peak / m;
}

/**
 * Suspenseful cinematic gaming-documentary bed: minor i–VI–III–VII progression,
 * pulsing sub bass, detuned pad, delayed pluck arpeggio, restrained drums.
 * Intro is filtered for the hook, drums enter after bar 2, ends with a tail.
 */
export function synthMusic(durationSec: number, opts: { bpm?: number; seed?: number; root?: number } = {}): Float32Array[] {
  const bpm = opts.bpm ?? 92;
  const root = opts.root ?? 50; // D3
  const r = rng(opts.seed ?? 7);
  const n = Math.ceil((durationSec + 1.5) * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const beat = 60 / bpm;
  const bar = beat * 4;
  // i – VI – III – VII in natural minor (semitones from root), 2 bars each
  const prog = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]];
  const chordAt = (t: number) => prog[Math.floor(t / (bar * 2)) % prog.length];

  const padLp = [new Biquad("lp", 900, 0.6), new Biquad("lp", 900, 0.6)];
  const hatHp = new Biquad("hp", 7000, 0.7);
  const snBp = new Biquad("bp", 1800, 0.8);
  const ph = new Float64Array(16);
  let bassPh = 0, kickPh = 0, pluckPh = 0;
  const end = durationSec;

  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const ch = chordAt(t);
    const fadeIn = Math.min(1, t / 1.2);
    const fadeOut = t > end - 1.2 ? Math.max(0, (end + 0.3 - t) / 1.5) : 1;
    const env = fadeIn * fadeOut;
    // Pad: 3 chord tones × 2 detuned saws, low-passed; filter opens over the first bars.
    let pl = 0, pr = 0;
    for (let k = 0; k < 3; k++) {
      const f = midi(root + ch[k]);
      for (let dtn = 0; dtn < 2; dtn++) {
        const idx = k * 2 + dtn;
        ph[idx] += (f * (dtn ? 1.004 : 0.996)) / SR;
        const s = saw(ph[idx] % 1);
        if (dtn) pr += s; else pl += s;
      }
    }
    const cutoff = 500 + Math.min(1, t / (bar * 2)) * 1400 + 300 * Math.sin(t * 0.7);
    if (i % 64 === 0) { padLp[0].set("lp", cutoff, 0.7); padLp[1].set("lp", cutoff, 0.7); }
    const pad = 0.055;
    let l = padLp[0].run(pl) * pad, rr = padLp[1].run(pr) * pad;

    // Sub bass: 8th-note pulse on chord root with ducking envelope.
    const eighth = beat / 2;
    const pe = (t % eighth) / eighth;
    bassPh += midi(root - 24 + ch[0]) / SR;
    const bassEnv = Math.pow(1 - pe, 1.8) * 0.9 + 0.1;
    const bass = Math.tanh(1.8 * Math.sin(2 * Math.PI * bassPh)) * 0.16 * bassEnv * (t > bar * 0.5 ? 1 : t / (bar * 0.5));
    l += bass; rr += bass;

    // Pluck arpeggio (16ths) — triangle with fast decay, panned, enters at bar 1.
    const six = beat / 4;
    const step = Math.floor(t / six);
    const sp = (t % six) / six;
    if (t > bar) {
      const notes = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[1] + 24];
      const f = midi(root + notes[step % 4]);
      pluckPh += f / SR;
      const pk = tri(pluckPh % 1) * Math.exp(-sp * 5) * 0.05;
      const pan = step % 2 ? 0.7 : 0.3;
      l += pk * (1 - pan) * 2; rr += pk * pan * 2;
    }

    // Drums after bar 2: kick on 1 & 3, clap on 2 & 4, soft hats on 8ths.
    if (t > bar * 2) {
      const bt = t % (beat * 2);
      if (bt < 0.35) {
        const kf = 45 + 90 * Math.exp(-bt * 30);
        kickPh += kf / SR;
        const k = Math.sin(2 * Math.PI * kickPh) * Math.exp(-bt * 9) * 0.32;
        l += k; rr += k;
      } else kickPh = 0;
      const st = (t + beat) % (beat * 2);
      if (st < 0.25) {
        const s = snBp.run(r()) * Math.exp(-st * 18) * 0.22;
        l += s; rr += s;
      } else snBp.run(0);
      const ht = t % eighth;
      const h = hatHp.run(r()) * Math.exp(-ht * 60) * (Math.floor(t / eighth) % 2 ? 0.05 : 0.03);
      l += h * 0.8; rr += h;
    }
    L[i] = l * env;
    R[i] = rr * env;
  }
  addEcho(L, R, beat * 0.75, 0.35, 0.22);
  normalizePeak([L, R], 0.89);
  return [L, R];
}

export type SfxType = "whoosh" | "impact" | "riser" | "reveal" | "tick";

export function synthSfx(type: SfxType, seed = 3): Float32Array[] {
  const r = rng(seed);
  const len = { whoosh: 0.6, impact: 1.4, riser: 1.5, reveal: 1.8, tick: 0.08 }[type];
  const n = Math.round(len * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const bp = new Biquad("bp", 500, 1.2);
  const lp = new Biquad("lp", 400, 0.7);
  let ph = 0, ph2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, x = t / len;
    let l = 0, rr = 0;
    if (type === "whoosh") {
      if (i % 32 === 0) bp.set("bp", 300 + 3200 * Math.sin(Math.PI * Math.min(1, x * 1.15)), 1.4);
      const s = bp.run(r()) * Math.pow(Math.sin(Math.PI * x), 2) * 1.6;
      l = s * (1 - x); rr = s * x; // pan sweep
    } else if (type === "impact") {
      const f = 38 + 70 * Math.exp(-t * 14);
      ph += f / SR;
      const boom = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 3.2);
      const crack = lp.run(r()) * Math.exp(-t * 25) * 2.5;
      l = rr = Math.tanh((boom + crack) * 1.4) * 0.9;
    } else if (type === "riser") {
      if (i % 32 === 0) bp.set("bp", 400 + 5000 * x * x, 2);
      const tone = Math.sin(2 * Math.PI * (ph += (200 + 900 * x * x) / SR)) * 0.25;
      const s = (bp.run(r()) * 1.3 + tone) * Math.pow(x, 2.2);
      l = s; rr = s * 0.95;
    } else if (type === "reveal") {
      const env = Math.min(1, t / 0.01) * Math.exp(-t * 2.4);
      for (const [h, a] of [[1, 0.5], [2, 0.25], [3.01, 0.18], [4.98, 0.1]] as const) {
        l += Math.sin(2 * Math.PI * 587.33 * h * t) * a * env;
        rr += Math.sin(2 * Math.PI * 587.33 * h * t * 1.003) * a * env;
      }
      ph2 += 73.4 / SR;
      const sub = Math.sin(2 * Math.PI * ph2) * Math.exp(-t * 4) * 0.6;
      l += sub; rr += sub;
    } else {
      l = rr = r() * Math.exp(-t * 120) * 0.7;
    }
    L[i] = l; R[i] = rr;
  }
  if (type !== "tick" && type !== "whoosh") addEcho(L, R, 0.11, 0.3, 0.25);
  normalizePeak([L, R], 0.9);
  return [L, R];
}

/** Place SFX at cue times on a stereo bed of the given length. */
export function buildSfxBed(durationSec: number, cues: { t: number; type: SfxType }[], sources: Partial<Record<SfxType, Float32Array[]>> = {}): Float32Array[] {
  const n = Math.ceil(durationSec * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const gain: Record<SfxType, number> = { whoosh: 0.55, impact: 0.7, riser: 0.45, reveal: 0.6, tick: 0.4 };
  cues.forEach((c, k) => {
    const s = sources[c.type] ?? synthSfx(c.type, 11 + k);
    const at = Math.round(c.t * SR);
    for (let i = 0; i < s[0].length && at + i < n; i++) {
      L[at + i] += s[0][i] * gain[c.type];
      R[at + i] += (s[1] ?? s[0])[i] * gain[c.type];
    }
  });
  return [L, R];
}
