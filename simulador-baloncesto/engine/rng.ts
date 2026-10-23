/**
 * Generador pseudoaleatorio con semilla (xoshiro128**), rápido y reproducible.
 * Cada worker usa una semilla derivada distinta, de modo que una misma semilla global
 * produce exactamente los mismos resultados con el mismo número de workers.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    // splitmix32 para inicializar el estado a partir de una semilla de 32 bits
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1;
  }

  /** Entero uniforme de 32 bits sin signo. */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.b, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.b << 9) >>> 0;
    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;
    this.c ^= t;
    this.d = rotl(this.d, 11);
    return result;
  }

  /** Uniforme en [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Normal estándar (Box-Muller). */
  normal(): number {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Erlang/gamma de forma entera k y media `mean`. */
  erlang(k: number, mean: number): number {
    let s = 0;
    for (let i = 0; i < k; i++) {
      let u = 0;
      while (u === 0) u = this.next();
      s -= Math.log(u);
    }
    return (s / k) * mean;
  }

  /** Índice aleatorio ponderado (pesos no negativos). Devuelve -1 si todos son 0. */
  weighted(weights: ArrayLike<number>, n = weights.length): number {
    let total = 0;
    for (let i = 0; i < n; i++) total += weights[i];
    if (total <= 0) return -1;
    let r = this.next() * total;
    for (let i = 0; i < n; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return n - 1;
  }
}

function rotl(x: number, k: number) {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** Semilla derivada para el worker i. */
export function deriveSeed(seed: number, i: number) {
  return (Math.imul(seed ^ 0x5bd1e995, 2654435761) + Math.imul(i + 1, 0x27d4eb2d)) >>> 0;
}
