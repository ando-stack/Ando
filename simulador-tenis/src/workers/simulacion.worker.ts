/// <reference lib="webworker" />
import type { FormatoPartido } from '../../config/formatos';
import { agregar } from '../../engine/agregacion';
import { errorDeCoherencia } from '../../engine/coherencia';
import { Simulador } from '../../engine/motor';
import { Rng } from '../../engine/rng';
import { ANCHO, type ParametrosPartido } from '../../engine/tipos';

export interface MensajeEntrada {
  params: ParametrosPartido;
  formato: FormatoPartido;
  n: number;
  semilla: number;
}

self.onmessage = (ev: MessageEvent<MensajeEntrada>) => {
  const { params, formato, n, semilla } = ev.data;
  const sim = new Simulador(params, formato, new Rng(semilla));
  const out = new Int32Array(n * ANCHO);
  const bloque = 500;
  for (let i = 0; i < n; i++) {
    sim.simular(out, i * ANCHO);
    if ((i + 1) % bloque === 0) self.postMessage({ tipo: 'progreso', hechos: i + 1 });
  }
  // Coherencia de TODAS las simulaciones con las reglas del formato.
  const res = agregar([out], formato, (o, off) => errorDeCoherencia(o, off, formato));
  self.postMessage({ tipo: 'fin', resultado: res });
};
