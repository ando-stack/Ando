import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { leerMarcador } from '../ingest/evaluacion';
import { fechaSemana, parsearCalendario, parsearCancelados, parsearCuadro } from '../ingest/fuentes/wikipedia';
import { validarHistorico } from '../ingest/historico';
import { Registro } from '../ingest/lib/registro';
import { claveNombre, dias, fechaDeDias, horaMadrid, superficie } from '../ingest/lib/util';
import type { PartidoNormalizado } from '../engine/perfiles';

const fx = (f: string) => readFileSync(join(import.meta.dirname, 'fixtures', f), 'utf8');

describe('utilidades', () => {
  it('claves de nombre tolerantes', () => {
    expect(claveNombre('Nikolás Sánchez Izquierdo')).toBe(claveNombre('Nikolas Sanchez-Izquierdo'));
    expect(claveNombre('Zhou Yi')).toBe(claveNombre('Yi Zhou'));
    expect(claveNombre('Elmer Møller')).toBe(claveNombre('Elmer Moller'));
    expect(claveNombre('Tiago Pereira (tennis)')).toBe(claveNombre('Tiago Pereira'));
  });
  it('fechas y superficies', () => {
    expect(fechaDeDias(dias('20261023'))).toBe('2026-10-23');
    expect(superficie('Hard (i)')).toBe('dura');
    expect(superficie('Clay')).toBe('tierra');
    expect(superficie('Grass')).toBe('hierba');
    expect(superficie('Carpet')).toBe('dura');
    // 14:00 UTC del 24 de octubre de 2026 = 16:00 en Madrid (horario de verano hasta el 25-10)
    expect(horaMadrid('2026-10-24T14:00Z')).toBe('2026-10-24 16:00');
    expect(horaMadrid('2026-11-02T14:00Z')).toBe('2026-11-02 15:00');
  });
});

describe('registro de jugadores', () => {
  it('empareja por nombre, desempata por país y crea jugadores nuevos', () => {
    const r = new Registro();
    r.anadir({ id: 'm1', pool: 'M', nombre: 'Marco Trungelliti', pais: 'ARG', nacimiento: null, mano: 'R', altura: null, alias: {} });
    r.anadir({ id: 'm2', pool: 'M', nombre: 'Juan Perez', pais: 'ARG', nacimiento: null, mano: null, altura: null, alias: {} });
    r.anadir({ id: 'm3', pool: 'M', nombre: 'Juan Perez', pais: 'ESP', nacimiento: null, mano: null, altura: null, alias: {} });
    expect(r.resolver('espn', '10', 'Marco Trungelliti', 'ARG', 'M').id).toBe('m1');
    expect(r.resolver('espn', '11', 'Juan Pérez', 'ESP', 'M').id).toBe('m3');
    // El alias queda guardado
    expect(r.porFuente('espn', '11')?.id).toBe('m3');
    const nuevo = r.resolver('wta', '99', 'Nueva Jugadora', 'FRA', 'F');
    expect(nuevo.id).toBe('f-wta-99');
    expect(r.nuevos.length).toBe(1);
  });
});

describe('Wikipedia', () => {
  it('lee el calendario del Challenger (superficie, cubierta, categoría, enlace al cuadro)', () => {
    const e = parsearCalendario(fx('wiki-calendario-ch-2026.txt'), 2026);
    expect(e.length).toBeGreaterThanOrEqual(5);
    const lisboa = e.find((x) => x.nombre === 'Lisboa Belém Open')!;
    expect(lisboa.semana).toBe('2026-10-19');
    expect(lisboa.superficie).toBe('tierra');
    expect(lisboa.cubierta).toBe(false);
    expect(lisboa.categoria).toBe('Challenger 100');
    expect(lisboa.paginaIndividual).toBe("2026 Lisboa Belém Open – Men's singles");
    expect(e.find((x) => x.ciudad === 'Fort Worth')?.superficie).toBe('dura');
  });

  it('lee los torneos cancelados y los dos formatos de fecha de semana', () => {
    const c = parsearCancelados(fx('wiki-cancelados-w125-2026.txt'), 2026);
    expect(c).toContainEqual({ semana: '2026-10-19', nombre: 'Rio Ladies Open', ciudad: 'Rio de Janeiro' });
    expect(c.find((x) => x.ciudad === 'Miami')?.semana).toBe('2026-11-02');
    expect(fechaSemana('19 Oct', 2026)).toBe('2026-10-19');
    expect(fechaSemana('October 19', 2026)).toBe('2026-10-19');
    expect(fechaSemana('Doubles', 2026)).toBeNull();
  });

  it('lee el cuadro: rondas, cabezas de serie, marcadores con tie-break y ganadores', () => {
    const c = parsearCuadro(fx('wiki-cuadro-lisboa-2026.txt'));
    const r32 = c.filter((p) => p.ronda === 'R32');
    expect(r32.length).toBe(16);
    const p1 = r32[0];
    expect(p1.a?.nombre).toBe('Marco Trungelliti');
    expect(p1.a?.semilla).toBe('1');
    expect(p1.b?.nombre).toBe('Tiago Pereira');
    expect(p1.sets).toEqual([
      { a: 7, b: 6, tb: 5 },
      { a: 4, b: 6, tb: null },
      { a: 6, b: 1, tb: null },
    ]);
    expect(p1.ganador).toBe('a');
    expect(c.filter((p) => p.ronda === 'R16').length).toBe(8);
    expect(c.filter((p) => p.ronda === 'QF').length).toBe(4);
    // Nombre abreviado sin enlace completado con el del propio cuadro
    expect(c.some((p) => p.a?.nombre === 'S Gulin' || p.b?.nombre === 'S Gulin')).toBe(false);
  });
});

describe('API de la WTA (estructura)', () => {
  it('contiene partidos individuales con estado, ronda y ganador', () => {
    const d = JSON.parse(fx('wta-ningbo-2026.json'));
    const s = d.matches.filter((m: { DrawMatchType: string }) => m.DrawMatchType === 'S');
    expect(s.length).toBeGreaterThan(30);
    const kawa = s.find((m: { MatchID: string }) => m.MatchID === 'RS017');
    expect(kawa.PlayerNameLastA).toBe('Kawa');
    expect(kawa.Winner).toBe('4'); // A gana por retirada
  });
});

describe('validación del histórico', () => {
  const base: PartidoNormalizado = {
    id: 'x1', fecha: dias('20250310'), pool: 'M', circuito: 'ATP', nivel: 'A', torneo: 'T', sup: 'dura', mejorDe: 3,
    ganador: 'm1', perdedor: 'm2', marcador: '6-4 6-4', ronda: 'R32', retirada: false, wo: false,
    w: [5, 2, 60, 38, 30, 12, 9, 2, 3], l: [3, 4, 62, 36, 24, 13, 9, 4, 6], fuente: 't',
  };
  it('descarta imposibles y duplicados y conserva el resto ordenado', () => {
    const { partidos, informe } = validarHistorico([
      { ...base, id: 'x2', fecha: base.fecha + 3 },
      base,
      { ...base, id: 'x3', ganador: 'm1', perdedor: 'm1' },
      { ...base },
      { ...base, id: 'x4', w: [5, 2, 60, 38, 30, 12, 9, 2, 999] },
    ]);
    expect(partidos.map((p) => p.id)).toEqual(['x1', 'x4', 'x2']);
    expect(partidos.find((p) => p.id === 'x4')?.w).toBeNull();
    expect(informe.descartados['duplicado']).toBe(1);
    expect(informe.descartados['mismo jugador en ambos lados']).toBe(1);
  });
  it('lee marcadores', () => {
    expect(leerMarcador('7-6(4) 3-6 6-3')).toEqual({ juegos: 31, sets: 3, juegosW: 16, setsW: 2 });
    expect(leerMarcador('6-3 2-1 RET')).toBeNull();
    expect(leerMarcador('W/O')).toBeNull();
  });
});
