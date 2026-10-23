/**
 * Registro de jugadores: identificador único y equivalencias entre fuentes.
 * Id canónico: "m<id Sackmann ATP>" / "f<id Sackmann WTA>"; si un jugador sólo aparece en una
 * fuente en vivo se crea "m-espn-<id>", "f-wta-<id>" o "m-wiki-<clave>".
 * El emparejamiento por nombre es tolerante a acentos, guiones y orden de las palabras, y
 * desempata por país.
 */
import type { Pool } from '../../engine/modelo';
import { claveNombre } from './util';

/** Algunas fuentes usan códigos ISO en lugar de los del COI. */
const ISO_A_COI: Record<string, string> = {
  DEU: 'GER', NLD: 'NED', CHE: 'SUI', PRT: 'POR', HRV: 'CRO', GRC: 'GRE', DNK: 'DEN', SVN: 'SLO', BGR: 'BUL', LVA: 'LAT',
  ZAF: 'RSA', CHL: 'CHI', PRY: 'PAR', URY: 'URU', MYS: 'MAS', IDN: 'INA', PHL: 'PHI', TWN: 'TPE', SRB: 'SRB', SER: 'SRB', TPO: 'TPE', MCO: 'MON', IRL: 'IRL',
};
export const paisCoi = (p: string | null | undefined) => {
  const x = (p ?? '').toUpperCase();
  return ISO_A_COI[x] ?? x;
};

export interface JugadorReg {
  id: string;
  pool: Pool;
  nombre: string;
  pais: string;
  nacimiento: string | null;
  mano: string | null;
  altura: number | null;
  alias: Record<string, string>;
}

export class Registro {
  readonly porId = new Map<string, JugadorReg>();
  private porClave = new Map<string, string[]>();
  private porAlias = new Map<string, string>();
  private porApellido = new Map<string, string[]>();
  /** Nombres que no se pudieron emparejar con el histórico (para el informe de la ingesta). */
  readonly nuevos: string[] = [];

  anadir(j: JugadorReg) {
    this.porId.set(j.id, j);
    const k = `${j.pool}|${claveNombre(j.nombre)}`;
    const l = this.porClave.get(k) ?? [];
    if (!l.includes(j.id)) l.push(j.id);
    this.porClave.set(k, l);
    for (const [f, v] of Object.entries(j.alias)) this.porAlias.set(`${f}:${v}`, j.id);
    for (const t of claveNombre(j.nombre).split(' ')) {
      if (t.length < 3) continue;
      const kk = `${j.pool}|${t}`;
      const la = this.porApellido.get(kk) ?? [];
      la.push(j.id);
      this.porApellido.set(kk, la);
    }
  }

  get(id: string) {
    return this.porId.get(id);
  }

  porFuente(fuente: string, idFuente: string): JugadorReg | undefined {
    const id = this.porAlias.get(`${fuente}:${idFuente}`);
    return id ? this.porId.get(id) : undefined;
  }

  /** Busca por nombre (y país para desempatar). Si hay varios candidatos sin desempate, prefiere el más activo. */
  buscar(nombre: string, pais: string | null, pool: Pool, actividad?: (id: string) => number): JugadorReg | undefined {
    const ids = this.porClave.get(`${pool}|${claveNombre(nombre)}`);
    if (!ids?.length) return this.buscarParcial(nombre, pais, pool, actividad);
    if (ids.length === 1) return this.porId.get(ids[0]);
    const conPais = pais ? ids.filter((i) => paisCoi(this.porId.get(i)?.pais) === paisCoi(pais)) : [];
    const candidatos = conPais.length ? conPais : ids;
    if (candidatos.length === 1 || !actividad) return this.porId.get(candidatos[0]);
    return this.porId.get([...candidatos].sort((a, b) => actividad(b) - actividad(a))[0]);
  }

  /**
   * Respaldo: nombres con segundos nombres o apellidos de más ("Yuriko Lily Miyazaki" ↔
   * "Yuriko Miyazaki"). Exige mismo país y que todas las palabras del nombre más corto
   * (al menos dos) estén en el más largo.
   */
  private buscarParcial(nombre: string, pais: string | null, pool: Pool, actividad?: (id: string) => number): JugadorReg | undefined {
    if (!pais) return undefined;
    const tk = claveNombre(nombre).split(' ').filter(Boolean);
    const candidatos = new Set<string>();
    for (const t of tk) for (const id of this.porApellido.get(`${pool}|${t}`) ?? []) candidatos.add(id);
    const ok = [...candidatos].filter((id) => {
      const j = this.porId.get(id)!;
      if (paisCoi(j.pais) !== paisCoi(pais)) return false;
      const tj = claveNombre(j.nombre).split(' ').filter(Boolean);
      const [corto, largo] = tj.length <= tk.length ? [tj, tk] : [tk, tj];
      return corto.length >= 2 && corto.every((t) => largo.includes(t));
    });
    if (!ok.length) return undefined;
    if (ok.length === 1 || !actividad) return this.porId.get(ok[0]);
    return this.porId.get(ok.sort((a, b) => actividad(b) - actividad(a))[0]);
  }

  /** Devuelve el jugador de una fuente en vivo, emparejándolo o creándolo. */
  resolver(
    fuente: string,
    idFuente: string,
    nombre: string,
    pais: string | null,
    pool: Pool,
    actividad?: (id: string) => number,
    extra: Partial<JugadorReg> = {},
  ): JugadorReg {
    const ya = this.porFuente(fuente, idFuente);
    if (ya) return ya;
    let j = this.buscar(nombre, pais, pool, actividad);
    if (j) {
      j.alias[fuente] = idFuente;
      this.porAlias.set(`${fuente}:${idFuente}`, j.id);
      if (!j.nacimiento && extra.nacimiento) j.nacimiento = extra.nacimiento;
      return j;
    }
    j = {
      id: `${pool.toLowerCase()}-${fuente}-${idFuente}`,
      pool,
      nombre,
      pais: pais ?? '',
      nacimiento: extra.nacimiento ?? null,
      mano: extra.mano ?? null,
      altura: extra.altura ?? null,
      alias: { [fuente]: idFuente },
    };
    this.nuevos.push(`${nombre} (${pais ?? '?'}, ${fuente})`);
    this.anadir(j);
    return j;
  }
}
