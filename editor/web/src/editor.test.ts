import { beforeEach, describe, expect, it } from 'vitest';
import { docVacio, nuevaForma, nuevaImagen, nuevoTexto, normalizarDoc } from './defaults';
import { FORMATOS } from './formats';
import { useEditor } from './store';
import { ajustarCalidad, nombreArchivo } from './utils/exportar';
import { hexARgb, rgbAHex } from './utils/color';
import { caja, recolocar } from './utils/relayout';
import { aplicarAjustes } from './canvas/componer';

const st = () => useEditor.getState();

describe('historial (deshacer/rehacer ilimitado)', () => {
  beforeEach(() => st().cargarDoc({ ...docVacio(1280, 720), id: 'p' }));

  it('deshace y rehace cualquier número de pasos', () => {
    const n = 250;
    for (let i = 0; i < n; i++) st().anadirCapa(nuevaForma('rect', i, i, 10, 10));
    expect(st().doc.layers).toHaveLength(n);
    for (let i = 0; i < n; i++) st().deshacer();
    expect(st().doc.layers).toHaveLength(0);
    for (let i = 0; i < n; i++) st().rehacer();
    expect(st().doc.layers).toHaveLength(n);
  });

  it('funde los cambios continuos de un deslizador en un solo paso', () => {
    const t = nuevoTexto(0, 0);
    st().anadirCapa(t);
    for (let i = 0; i < 20; i++) st().actualizarCapa(t.id, { opacity: 1 - i / 40 }, 'opacidad');
    expect(st().historial.pasado.length).toBe(2);
    st().deshacer();
    expect(st().doc.layers[0].opacity).toBe(1);
  });

  it('un cambio nuevo borra el futuro', () => {
    st().anadirCapa(nuevaForma('rect', 0, 0, 10, 10));
    st().deshacer();
    expect(st().historial.futuro).toHaveLength(1);
    st().anadirCapa(nuevaForma('ellipse', 0, 0, 10, 10));
    expect(st().historial.futuro).toHaveLength(0);
  });
});

describe('operaciones de capas', () => {
  beforeEach(() => st().cargarDoc({ ...docVacio(1280, 720), id: 'p' }));

  it('duplica, reordena, agrupa y borra', () => {
    const a = nuevaForma('rect', 0, 0, 10, 10);
    const b = nuevaForma('ellipse', 0, 0, 10, 10);
    st().anadirCapa(a);
    st().anadirCapa(b);
    st().seleccionar([a.id]);
    st().duplicarSeleccion();
    expect(st().doc.layers).toHaveLength(3);
    st().subirBajar('arriba');
    expect(st().doc.layers[2].id).toBe(st().seleccion[0]);
    st().seleccionar([a.id, b.id], false);
    st().agrupar();
    expect(st().doc.groups).toHaveLength(1);
    expect(st().doc.layers.filter((l) => l.groupId).length).toBe(2);
    st().desagrupar();
    expect(st().doc.groups).toHaveLength(0);
    st().seleccionar([a.id]);
    st().borrarSeleccion();
    expect(st().doc.layers.find((l) => l.id === a.id)).toBeUndefined();
  });

  it('no borra capas bloqueadas', () => {
    const a = nuevaForma('rect', 0, 0, 10, 10);
    a.locked = true;
    st().anadirCapa(a);
    st().seleccionar([a.id]);
    st().borrarSeleccion();
    expect(st().doc.layers).toHaveLength(1);
  });

  it('las capas nuevas quedan debajo de la referencia original', () => {
    const orig = nuevaImagen('/o.png', 0, 0, 1280, 720, 'Original', 'original');
    st().cargarDoc({ ...docVacio(1280, 720), id: 'p', layers: [orig] });
    st().anadirCapa(nuevoTexto(10, 10));
    expect(st().doc.layers[1].role).toBe('original');
  });
});

describe('recolocación al cambiar de formato', () => {
  it('el fondo cubre el nuevo lienzo y los elementos siguen dentro', () => {
    const fondo = nuevaImagen('/f.png', 0, 0, 1280, 720, 'Fondo', 'fondo');
    const sujeto = nuevaImagen('/s.png', 900, 100, 350, 600, 'Persona', 'sujeto');
    const texto = { ...nuevoTexto(40, 40, 'HOLA', 120), width: 500, height: 130 };
    const d = { ...docVacio(1280, 720), layers: [fondo, sujeto, texto] };
    const r = recolocar(d, 1080, 1350);
    expect(r.width).toBe(1080);
    const f = caja(r.layers[0]);
    expect(f.w).toBeGreaterThanOrEqual(1080 - 0.5);
    expect(f.h).toBeGreaterThanOrEqual(1350 - 0.5);
    for (const l of r.layers.slice(1)) {
      const c = caja(l);
      expect(c.x).toBeGreaterThanOrEqual(-0.5);
      expect(c.x + c.w).toBeLessThanOrEqual(1080.5);
      expect(c.y + c.h).toBeLessThanOrEqual(1350.5);
    }
    // el sujeto anclado a la derecha sigue a la derecha
    const s = caja(r.layers[1]);
    expect(s.x + s.w).toBeGreaterThan(1080 * 0.8);
    // el texto escala su tamaño de letra
    expect((r.layers[2] as typeof texto).fontSize).toBeCloseTo(120 * (1080 / 1280), 1);
  });
});

describe('exportación', () => {
  it('busca la mejor calidad que cabe en el peso máximo', async () => {
    const codificar = async (q: number) => ({ size: Math.round(q * 1000) });
    const r = await ajustarCalidad(codificar, 700, 0.95);
    expect(r.cabe).toBe(true);
    expect(r.resultado.size).toBeLessThanOrEqual(700);
    expect(r.calidad).toBeGreaterThan(0.65);
  });

  it('avisa si ni con la calidad mínima cabe', async () => {
    const r = await ajustarCalidad(async () => ({ size: 5000 }), 100, 0.9);
    expect(r.cabe).toBe(false);
  });

  it('formatos predefinidos con los tamaños pedidos', () => {
    const p = Object.fromEntries(FORMATOS.map((f) => [f.id, [f.ancho, f.alto]]));
    expect(p['yt']).toEqual([3840, 2160]);
    expect(p['yt-movil']).toEqual([1280, 720]);
    expect(p['ig-45']).toEqual([1080, 1350]);
    expect(p['ig-11']).toEqual([1080, 1080]);
    expect(p['historia']).toEqual([1080, 1920]);
    expect(p['x-cabecera']).toEqual([1500, 500]);
    expect(p['a4']).toEqual([2480, 3508]);
    expect(p['a3']).toEqual([3508, 4961]);
    expect(FORMATOS.find((f) => f.id === 'yt-movil')?.maxBytes).toBe(2 * 1024 * 1024);
  });

  it('nombres de archivo seguros', () => {
    expect(nombreArchivo('¡Mi miniatura épica!')).toBe('Mi_miniatura_epica');
  });
});

describe('utilidades', () => {
  it('convierte colores', () => {
    expect(hexARgb('#ff8000')).toEqual([255, 128, 0]);
    expect(rgbAHex(255, 128, 0)).toBe('#ff8000');
  });

  it('ajustes de imagen: blanco y negro y brillo', () => {
    const d = new Uint8ClampedArray([200, 100, 50, 255]);
    aplicarAjustes(d, { brightness: 0, contrast: 0, saturation: 0, temperature: 0, sharpen: 0, blur: 0, filter: 'bn' });
    expect(d[0]).toBe(d[1]);
    expect(d[1]).toBe(d[2]);
    const e = new Uint8ClampedArray([100, 100, 100, 255]);
    aplicarAjustes(e, { brightness: 50, contrast: 0, saturation: 0, temperature: 0, sharpen: 0, blur: 0, filter: 'none' });
    expect(e[0]).toBeGreaterThan(100);
  });

  it('normaliza proyectos antiguos o del motor', () => {
    const d = normalizarDoc({ width: 100, height: 50, layers: [{ id: 'x', type: 'text', name: 't', text: 'A' } as never] });
    expect(d.guides).toEqual({ x: [], y: [] });
    const t = d.layers[0] as ReturnType<typeof nuevoTexto>;
    expect(t.strokes).toEqual([]);
    expect(t.shadow.enabled).toBe(false);
  });
});
