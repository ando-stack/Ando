/**
 * Generador pseudoaleatorio con semilla: xoshiro128** (Blackman y Vigna).
 * Rápido, de buena calidad estadística y reproducible: la misma semilla da la misma secuencia.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private normalGuardada: number | null = null;

  constructor(semilla: number) {
    // splitmix32 para repartir la semilla en los cuatro estados.
    let s = semilla >>> 0;
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

  /** Entero sin signo de 32 bits. */
  nextU32(): number {
    const r = Math.imul(rotl(Math.imul(this.b, 5), 7), 9) >>> 0;
    const t = this.b << 9;
    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;
    this.c ^= t;
    this.d = rotl(this.d, 11);
    return r;
  }

  /** Uniforme en [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Normal estándar (Box-Muller). */
  normal(): number {
    if (this.normalGuardada !== null) {
      const v = this.normalGuardada;
      this.normalGuardada = null;
      return v;
    }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.normalGuardada = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** Deriva semillas independientes para cada worker a partir de la semilla principal. */
export function semillaDerivada(semilla: number, indice: number): number {
  let h = (semilla ^ Math.imul(indice + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}
