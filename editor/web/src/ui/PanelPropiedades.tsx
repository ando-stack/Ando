import { AlignCenter, AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignLeft, AlignRight, AlignStartHorizontal, AlignStartVertical, FlipHorizontal, FlipVertical, Plus, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { alinear, aplicarEstilo, ESTILOS_TEXTO, recrearComoTexto, reemplazarImagen, unirSeleccion, voltear } from '../acciones';
import { api } from '../api';
import { cargarImagen } from '../canvas/componer';
import { capaDesdeRecorte, useSegmento } from '../canvas/refs';
import { nuevaImagen } from '../defaults';
import { asegurarFuente, cargarGoogleFont, familias, registrarPropias } from '../fonts';
import { useEditor } from '../store';
import type { Adjustments, Fill, ImageLayer, Layer, Shadow, ShapeLayer, TextLayer } from '../types';
import { Boton, Deslizador, Interruptor, Numero, Seccion, Selector, SelectorColor } from './controles';

const st = () => useEditor.getState();

export function PanelPropiedades() {
  const { doc, seleccion, herramienta } = useEditor();
  const seg = useSegmento();
  const sel = doc.layers.filter((l) => seleccion.includes(l.id));
  const una = sel.length === 1 ? sel[0] : null;
  return (
    <div className="h-full overflow-y-auto" data-testid="panel-propiedades">
      {herramienta === 'segment' && (seg.previa || seg.puntos.length > 0) && <ConfirmarSegmento />}
      {!sel.length && <PropsDocumento />}
      {sel.length > 0 && <PropsTransformacion capas={sel} />}
      {una?.warnings?.length ? (
        <div className="m-3 space-y-1 rounded border border-aviso/50 bg-aviso/10 p-2 text-xs text-aviso">
          {una.warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      ) : null}
      {una?.type === 'text' && <PropsTexto capa={una} />}
      {una?.type === 'image' && <PropsImagen capa={una} />}
      {una?.type === 'shape' && <PropsForma capa={una} />}
      {sel.length > 1 && <p className="p-3 text-xs text-tenue">{sel.length} capas seleccionadas.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ documento

function PropsDocumento() {
  const { doc } = useEditor();
  const dec = doc.decomposition;
  const original = doc.layers.find((l) => l.role === 'original');
  return (
    <>
      <Seccion titulo="Documento">
        <label className="flex items-center gap-2 text-xs">
          <span className="w-24 text-tenue">Nombre</span>
          <input className="flex-1 rounded bg-panel2 px-1 py-0.5" value={doc.name} onChange={(e) => st().cambiar((d) => ({ ...d, name: e.target.value }), 'nombre-doc')} />
        </label>
        <div className="text-xs text-tenue">
          {doc.width} × {doc.height} px
        </div>
        <SelectorColor etiqueta="Color de fondo" valor={doc.background} clave="fondo-doc" onChange={(c, k) => st().cambiar((d) => ({ ...d, background: c }), k)} />
        <Boton onClick={() => st().set({ dialogo: 'formatos' })}>Cambiar formato / tamaño…</Boton>
      </Seccion>
      {dec && (
        <Seccion titulo="Descomposición con IA">
          <div className="text-xs">
            Similitud con el original: <b className={dec.metrics.ssim >= 0.9 ? 'text-ok' : dec.metrics.ssim >= 0.75 ? 'text-aviso' : 'text-peligro'}>{Math.round(dec.metrics.ssim * 100)}%</b>
            <span className="text-tenue"> (SSIM) · PSNR {dec.metrics.psnr} dB</span>
          </div>
          {dec.metrics.total_s !== undefined && <div className="text-xxs text-tenue">Procesado en {dec.metrics.total_s} s</div>}
          {dec.warnings.map((w, i) => (
            <p key={i} className="text-xs text-aviso">
              {w}
            </p>
          ))}
          {original && (
            <Interruptor etiqueta="Ver la imagen original encima (referencia bloqueada)" valor={original.visible} onChange={(v) => st().actualizarCapa(original.id, { visible: v })} />
          )}
          <p className="text-xxs text-tenue">El punto de color de cada capa indica la confianza de la IA. Revisa las capas en ámbar o rojo.</p>
        </Seccion>
      )}
      <Seccion titulo="Paleta del original" abierta={!!doc.palette.length}>
        <div className="flex flex-wrap gap-1">
          {doc.palette.map((c) => (
            <button key={c} type="button" title={`${c} (clic para copiar)`} className="h-6 w-6 rounded border border-borde" style={{ background: c }} onClick={() => navigator.clipboard?.writeText(c).catch(() => undefined)} />
          ))}
          {!doc.palette.length && <span className="text-xs text-tenue">Se extrae al descomponer una imagen.</span>}
        </div>
      </Seccion>
    </>
  );
}

// ------------------------------------------------------------------ segmentación

function ConfirmarSegmento() {
  const seg = useSegmento();
  const { doc } = useEditor();
  const origen = doc.layers.find((l) => l.id === seg.origenId) as ImageLayer | undefined;
  const crear = async (quitar: boolean) => {
    if (!seg.previa || !origen) return;
    const im = await cargarImagen(origen.src);
    const g = capaDesdeRecorte(origen, im.width, im.height, seg.previa);
    const capa = nuevaImagen(seg.previa.src, g.x, g.y, g.width, g.height, 'Recorte', 'objeto');
    Object.assign(capa, { rotation: g.rotation, scaleX: g.scaleX, scaleY: g.scaleY, confidence: seg.previa.confidence });
    st().set({ ocupado: quitar ? 'Rellenando el hueco en el origen…' : null });
    try {
      let nuevoOrigen: string | undefined;
      if (quitar) {
        const r = await api.segmentar({ proyecto: doc.id, recurso: origen.src, puntos: seg.puntos.length ? seg.puntos : undefined, caja: seg.puntos.length ? undefined : [seg.previa.x, seg.previa.y, seg.previa.x + seg.previa.width, seg.previa.y + seg.previa.height], quitar_del_origen: true });
        nuevoOrigen = r.origen;
      }
      st().cambiar((d) => {
        const capas = d.layers.map((l) => (nuevoOrigen && l.id === origen.id && l.role !== 'original' ? { ...l, src: nuevoOrigen } : l));
        // la capa nueva va justo encima de su origen (o del fondo, si el origen es la referencia)
        let idx = capas.findIndex((l) => l.id === origen.id) + 1;
        if (origen.role === 'original') {
          const iFondo = capas.map((l) => l.role).lastIndexOf('fondo');
          idx = iFondo >= 0 ? iFondo + 1 : capas.findIndex((l) => l.id === origen.id);
        }
        capas.splice(Math.max(0, idx), 0, capa);
        return { ...d, layers: capas };
      });
      st().set({ seleccion: [capa.id] });
      seg.limpiar();
    } catch (e) {
      st().avisar((e as Error).message, 'error');
    } finally {
      st().set({ ocupado: null });
    }
  };
  return (
    <Seccion titulo="Segmentación">
      <p className="text-xs text-tenue">{seg.puntos.length} punto(s). {seg.previa ? `Confianza ${Math.round(seg.previa.confidence * 100)}%` : ''}</p>
      <div className="flex flex-wrap gap-1">
        <Boton tipo="primario" deshabilitado={!seg.previa} onClick={() => crear(false)} testid="crear-capa-segmento">Crear capa</Boton>
        <Boton deshabilitado={!seg.previa || origen?.role === 'original'} titulo="Crea la capa y rellena el hueco en la capa de origen" onClick={() => crear(true)}>Crear y quitar del origen</Boton>
        <Boton onClick={seg.limpiar}>Cancelar</Boton>
      </div>
    </Seccion>
  );
}

// ------------------------------------------------------------------ transformación

function PropsTransformacion({ capas }: { capas: Layer[] }) {
  const una = capas.length === 1 ? capas[0] : null;
  return (
    <Seccion titulo="Transformar">
      {una && (
        <div className="grid grid-cols-2 gap-2">
          <Numero etiqueta="X" valor={una.x} onChange={(v) => st().actualizarCapa(una.id, { x: v }, 'x')} />
          <Numero etiqueta="Y" valor={una.y} onChange={(v) => st().actualizarCapa(una.id, { y: v }, 'y')} />
          <Numero etiqueta="Escala %" valor={Math.abs(una.scaleX) * 100} onChange={(v) => st().actualizarCapa(una.id, { scaleX: (Math.sign(una.scaleX) || 1) * v / 100, scaleY: (Math.sign(una.scaleY) || 1) * v / 100 }, 'escala')} />
          <Numero etiqueta="Giro °" valor={una.rotation} onChange={(v) => st().actualizarCapa(una.id, { rotation: v }, 'giro')} />
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        <Boton titulo="Voltear horizontal (Shift+H)" onClick={() => voltear('h')}><FlipHorizontal size={14} /></Boton>
        <Boton titulo="Voltear vertical (Shift+V)" onClick={() => voltear('v')}><FlipVertical size={14} /></Boton>
        <span className="mx-1 w-px bg-borde" />
        <Boton titulo="Alinear a la izquierda" onClick={() => alinear('izq')}><AlignStartVertical size={14} /></Boton>
        <Boton titulo="Centrar horizontalmente" onClick={() => alinear('centroH')}><AlignCenterVertical size={14} /></Boton>
        <Boton titulo="Alinear a la derecha" onClick={() => alinear('der')}><AlignEndVertical size={14} /></Boton>
        <Boton titulo="Alinear arriba" onClick={() => alinear('arriba')}><AlignStartHorizontal size={14} /></Boton>
        <Boton titulo="Centrar verticalmente" onClick={() => alinear('centroV')}><AlignCenterHorizontal size={14} /></Boton>
        <Boton titulo="Alinear abajo" onClick={() => alinear('abajo')}><AlignEndHorizontal size={14} /></Boton>
      </div>
      {una && una.type !== 'image' && (
        <Boton titulo="Convierte la capa en imagen para usar máscaras, borrador y ajustes" onClick={() => unirSeleccion(true)}>Rasterizar capa</Boton>
      )}
    </Seccion>
  );
}

// ------------------------------------------------------------------ relleno / sombra reutilizables

function EditorRelleno({ valor, onChange, clave }: { valor: Fill; onChange: (f: Fill, clave: string) => void; clave: string }) {
  return (
    <div className="space-y-2">
      <Selector etiqueta="Relleno" valor={valor.type} opciones={[{ v: 'solid', t: 'Color sólido' }, { v: 'linear', t: 'Degradado' }]} onChange={(t) => onChange({ ...valor, type: t, gradient: { ...valor.gradient, colors: valor.gradient.colors.length >= 2 ? valor.gradient.colors : [valor.color, '#000000'] } }, clave)} />
      {valor.type === 'solid' ? (
        <SelectorColor etiqueta="Color" valor={valor.color} clave={clave + ':c'} onChange={(c, k) => onChange({ ...valor, color: c }, k)} />
      ) : (
        <>
          {valor.gradient.colors.map((c, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="flex-1">
                <SelectorColor etiqueta={`Color ${i + 1}`} valor={c} clave={`${clave}:g${i}`} onChange={(nc, k) => { const cs = [...valor.gradient.colors]; cs[i] = nc; onChange({ ...valor, color: cs[0], gradient: { ...valor.gradient, colors: cs } }, k); }} />
              </div>
              {valor.gradient.colors.length > 2 && (
                <button type="button" aria-label="Quitar color" onClick={() => onChange({ ...valor, gradient: { ...valor.gradient, colors: valor.gradient.colors.filter((_, j) => j !== i) } }, clave)}>
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
          {valor.gradient.colors.length < 5 && <Boton onClick={() => onChange({ ...valor, gradient: { ...valor.gradient, colors: [...valor.gradient.colors, '#ffffff'] } }, clave)}><Plus size={12} /> Color</Boton>}
          <Deslizador etiqueta="Ángulo" valor={valor.gradient.angle} min={0} max={360} clave={clave + ':ang'} onChange={(v, k) => onChange({ ...valor, gradient: { ...valor.gradient, angle: v } }, k)} sufijo="°" />
        </>
      )}
    </div>
  );
}

function EditorSombra({ titulo, valor, onChange, clave }: { titulo: string; valor: Shadow; onChange: (s: Shadow, clave: string) => void; clave: string }) {
  return (
    <div className="space-y-2">
      <Interruptor etiqueta={titulo} valor={valor.enabled} onChange={(v) => onChange({ ...valor, enabled: v }, clave)} />
      {valor.enabled && (
        <>
          <SelectorColor etiqueta="Color" valor={valor.color} clave={clave + ':c'} onChange={(c, k) => onChange({ ...valor, color: c }, k)} />
          <Deslizador etiqueta="Desplaz. X" valor={valor.offsetX} min={-100} max={100} clave={clave + ':x'} onChange={(v, k) => onChange({ ...valor, offsetX: v }, k)} />
          <Deslizador etiqueta="Desplaz. Y" valor={valor.offsetY} min={-100} max={100} clave={clave + ':y'} onChange={(v, k) => onChange({ ...valor, offsetY: v }, k)} />
          <Deslizador etiqueta="Desenfoque" valor={valor.blur} min={0} max={100} clave={clave + ':b'} onChange={(v, k) => onChange({ ...valor, blur: v }, k)} />
          <Deslizador etiqueta="Opacidad" valor={valor.opacity} min={0} max={1} paso={0.01} clave={clave + ':o'} onChange={(v, k) => onChange({ ...valor, opacity: v }, k)} />
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ texto

function SelectorFuente({ capa }: { capa: TextLayer }) {
  const [filtro, setFiltro] = useState('');
  const [google, setGoogle] = useState('');
  const [, setVersion] = useState(0);
  const archivo = useRef<HTMLInputElement>(null);
  const lista = useMemo(() => familias().filter((f) => f.familia.toLowerCase().includes(filtro.toLowerCase())), [filtro, capa.fontFamily]); // eslint-disable-line react-hooks/exhaustive-deps
  const cambiar = async (familia: string, peso?: number) => {
    const p = peso ?? capa.fontWeight;
    await asegurarFuente(familia, p);
    st().actualizarCapa(capa.id, { fontFamily: familia, fontWeight: p } as Partial<TextLayer>);
  };
  const subir = async (f: File) => {
    const d = st().doc;
    try {
      const r = await api.subirFuente(d.id, f);
      const propias = [...d.customFonts.filter((c) => c.family !== r.familia), { family: r.familia, url: r.url }];
      await registrarPropias(propias);
      st().cambiar((dd) => ({ ...dd, customFonts: propias }));
      await cambiar(r.familia, 400);
      setVersion((v) => v + 1);
      st().avisar(`Fuente «${r.familia}» añadida al proyecto.`, 'ok');
    } catch (e) {
      st().avisar((e as Error).message, 'error');
    }
  };
  return (
    <div className="space-y-2">
      {!!capa.fontCandidates?.length && (
        <div>
          <div className="mb-1 text-xxs text-tenue">Fuentes más parecidas (IA)</div>
          <div className="flex flex-wrap gap-1">
            {capa.fontCandidates.map((f) => (
              <button key={f.familia} type="button" onClick={() => cambiar(f.familia, f.peso)} className={`rounded px-2 py-1 text-xs ${capa.fontFamily === f.familia ? 'bg-acento text-white' : 'bg-panel2 hover:bg-borde'}`} style={{ fontFamily: `"${f.familia}"` }} title={`Parecido: ${Math.round(f.puntuacion * 100)}%`}>
                {f.familia} <span className="text-xxs opacity-70">{Math.round(f.puntuacion * 100)}%</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <input className="w-full rounded bg-panel2 px-2 py-1 text-xs" placeholder="Buscar fuente…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
      <div className="max-h-40 overflow-y-auto rounded bg-panel2">
        {lista.map((f) => (
          <button key={f.familia} type="button" onMouseEnter={() => void asegurarFuente(f.familia)} onClick={() => cambiar(f.familia)} className={`block w-full truncate px-2 py-1 text-left text-sm hover:bg-borde ${capa.fontFamily === f.familia ? 'text-acento' : ''}`} style={{ fontFamily: `"${f.familia}"` }}>
            {f.familia} <span className="font-sans text-xxs text-tenue">{f.origen === 'propia' ? 'propia' : f.origen === 'google' ? 'Google' : f.categoria}</span>
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        <input className="min-w-0 flex-1 rounded bg-panel2 px-2 py-1 text-xs" placeholder="Otra de Google Fonts (nombre)" value={google} onChange={(e) => setGoogle(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <Boton
          titulo="Descarga la fuente desde Google Fonts (solo se envía el nombre)"
          onClick={async () => {
            try {
              const f = await cargarGoogleFont(google);
              await cambiar(f.familia, 400);
              setGoogle('');
            } catch (e) {
              st().avisar((e as Error).message, 'error');
            }
          }}
        >
          Cargar
        </Boton>
      </div>
      <Boton onClick={() => archivo.current?.click()}>Subir fuente propia (.ttf, .otf, .woff2)</Boton>
      <input ref={archivo} type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f); e.target.value = ''; }} />
    </div>
  );
}

function PropsTexto({ capa }: { capa: TextLayer }) {
  const up = (c: Partial<TextLayer>, clave?: string) => st().actualizarCapa(capa.id, c, clave);
  useEffect(() => {
    void asegurarFuente(capa.fontFamily, capa.fontWeight);
  }, [capa.fontFamily, capa.fontWeight]);
  return (
    <>
      <Seccion titulo="Texto">
        <textarea data-testid="contenido-texto" className="h-16 w-full rounded bg-panel2 p-2 text-sm" value={capa.text} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => up({ text: e.target.value, name: `Texto: ${e.target.value.slice(0, 24)}` }, 'texto-' + capa.id)} />
        <SelectorFuente capa={capa} />
        <div className="grid grid-cols-2 gap-2">
          <Numero etiqueta="Tamaño" valor={capa.fontSize} onChange={(v) => up({ fontSize: Math.max(4, v) }, 'tam')} />
          <Selector valor={String(capa.fontWeight)} opciones={[100, 300, 400, 500, 600, 700, 800, 900].map((p) => ({ v: String(p), t: `Peso ${p}` }))} onChange={async (v) => { await asegurarFuente(capa.fontFamily, Number(v)); up({ fontWeight: Number(v) }); }} />
        </div>
        <Deslizador etiqueta="Espaciado" valor={capa.letterSpacing} min={-30} max={100} clave="esp" onChange={(v, k) => up({ letterSpacing: v }, k)} />
        <Deslizador etiqueta="Interlineado" valor={capa.lineHeight} min={0.6} max={2.5} paso={0.01} clave="lh" onChange={(v, k) => up({ lineHeight: v }, k)} />
        <div className="flex items-center gap-1">
          {(['left', 'center', 'right'] as const).map((a) => (
            <Boton key={a} activo={capa.align === a} titulo={{ left: 'Izquierda', center: 'Centro', right: 'Derecha' }[a]} onClick={() => up({ align: a })}>
              {a === 'left' ? <AlignLeft size={14} /> : a === 'center' ? <AlignCenter size={14} /> : <AlignRight size={14} />}
            </Boton>
          ))}
          <Boton activo={!!capa.uppercase} titulo="Mayúsculas" onClick={() => up({ uppercase: !capa.uppercase })}>AA</Boton>
          <Boton activo={!!capa.italic} titulo="Cursiva" onClick={() => up({ italic: !capa.italic })}><i>I</i></Boton>
        </div>
        <Deslizador etiqueta="Inclinación" valor={capa.skewX} min={-60} max={60} clave="skew" onChange={(v, k) => up({ skewX: v }, k)} />
        <Deslizador etiqueta="Curvatura" valor={capa.curve} min={-100} max={100} clave="curva" onChange={(v, k) => up({ curve: v }, k)} />
      </Seccion>
      <Seccion titulo="Estilos predefinidos">
        <div className="grid grid-cols-2 gap-1">
          {ESTILOS_TEXTO.map((s) => (
            <button key={s.nombre} type="button" onClick={() => aplicarEstilo(s)} className="truncate rounded bg-panel2 px-2 py-2 text-left text-xs hover:bg-borde" style={{ fontFamily: `"${s.aplicar.fontFamily}"`, color: s.aplicar.fill?.color, WebkitTextStroke: s.aplicar.strokes?.[0] ? `1px ${s.aplicar.strokes[0].color}` : undefined }}>
              {s.nombre}
            </button>
          ))}
        </div>
      </Seccion>
      <Seccion titulo="Color">
        <EditorRelleno valor={capa.fill} clave="relleno" onChange={(f, k) => up({ fill: f }, k)} />
      </Seccion>
      <Seccion titulo={`Contornos (${capa.strokes.length})`} extra={<Boton titulo="Añadir contorno" onClick={() => up({ strokes: [...capa.strokes, { color: capa.strokes.length % 2 ? '#ffffff' : '#000000', width: Math.max(2, Math.round(capa.fontSize * 0.06)) }] })}><Plus size={12} /></Boton>}>
        {capa.strokes.map((s, i) => (
          <div key={i} className="space-y-1 rounded bg-panel2/50 p-2">
            <div className="flex items-center justify-between text-xxs text-tenue">
              <span>Contorno {i + 1} {i === 0 ? '(interior)' : ''}</span>
              <button type="button" aria-label="Quitar contorno" onClick={() => up({ strokes: capa.strokes.filter((_, j) => j !== i) })}><Trash2 size={12} /></button>
            </div>
            <SelectorColor etiqueta="Color" valor={s.color} clave={`st${i}`} onChange={(c, k) => up({ strokes: capa.strokes.map((x, j) => (j === i ? { ...x, color: c } : x)) }, k)} />
            <Deslizador etiqueta="Grosor" valor={s.width} min={0} max={80} paso={0.5} clave={`stw${i}`} onChange={(v, k) => up({ strokes: capa.strokes.map((x, j) => (j === i ? { ...x, width: v } : x)) }, k)} />
          </div>
        ))}
      </Seccion>
      <Seccion titulo="Sombra, resplandor y 3D" abierta={capa.shadow.enabled || capa.glow.enabled || capa.extrude.enabled}>
        <EditorSombra titulo="Sombra" valor={capa.shadow} clave="sombra" onChange={(s, k) => up({ shadow: s }, k)} />
        <Interruptor etiqueta="Resplandor" valor={capa.glow.enabled} onChange={(v) => up({ glow: { ...capa.glow, enabled: v } })} />
        {capa.glow.enabled && (
          <>
            <SelectorColor etiqueta="Color" valor={capa.glow.color} clave="glowc" onChange={(c, k) => up({ glow: { ...capa.glow, color: c } }, k)} />
            <Deslizador etiqueta="Tamaño" valor={capa.glow.blur} min={0} max={120} clave="glowb" onChange={(v, k) => up({ glow: { ...capa.glow, blur: v } }, k)} />
            <Deslizador etiqueta="Intensidad" valor={capa.glow.strength} min={0.1} max={2} paso={0.05} clave="glows" onChange={(v, k) => up({ glow: { ...capa.glow, strength: v } }, k)} />
          </>
        )}
        <Interruptor etiqueta="Efecto 3D / extrusión" valor={capa.extrude.enabled} onChange={(v) => up({ extrude: { ...capa.extrude, enabled: v } })} />
        {capa.extrude.enabled && (
          <>
            <SelectorColor etiqueta="Color" valor={capa.extrude.color} clave="extc" onChange={(c, k) => up({ extrude: { ...capa.extrude, color: c } }, k)} />
            <Deslizador etiqueta="Profundidad" valor={capa.extrude.depth} min={1} max={60} clave="extd" onChange={(v, k) => up({ extrude: { ...capa.extrude, depth: v } }, k)} />
            <Deslizador etiqueta="Dirección" valor={capa.extrude.angle} min={0} max={360} clave="exta" onChange={(v, k) => up({ extrude: { ...capa.extrude, angle: v } }, k)} sufijo="°" />
          </>
        )}
      </Seccion>
    </>
  );
}

// ------------------------------------------------------------------ imagen

const FILTROS: { v: Adjustments['filter']; t: string }[] = [
  { v: 'none', t: 'Ninguno' },
  { v: 'bn', t: 'Blanco y negro' },
  { v: 'sepia', t: 'Sepia' },
  { v: 'frio', t: 'Frío' },
  { v: 'calido', t: 'Cálido' },
  { v: 'vintage', t: 'Vintage' },
  { v: 'dramatico', t: 'Dramático' },
  { v: 'invertir', t: 'Invertir' },
];

function PropsImagen({ capa }: { capa: ImageLayer }) {
  const up = (c: Partial<ImageLayer>, clave?: string) => st().actualizarCapa(capa.id, c, clave);
  const a = capa.adjustments;
  const ef = capa.effects;
  const archivo = useRef<HTMLInputElement>(null);
  const [quitarFondo, setQuitarFondo] = useState(capa.role === 'sujeto' || capa.role === 'objeto');
  const setA = (p: Partial<Adjustments>, clave: string) => up({ adjustments: { ...a, ...p } }, clave);
  return (
    <>
      {capa.linkedTextId && (
        <Seccion titulo="Texto como imagen">
          <p className="text-xs text-tenue">Este texto se dejó como imagen porque no se pudo reconstruir con fidelidad.</p>
          <Boton tipo="primario" onClick={() => recrearComoTexto(capa)}><Wand2 size={12} /> Recrear como texto</Boton>
        </Seccion>
      )}
      <Seccion titulo="Imagen">
        <div className="flex flex-wrap gap-1">
          <Boton onClick={() => archivo.current?.click()}>Reemplazar imagen…</Boton>
          <Interruptor etiqueta="quitar fondo" valor={quitarFondo} onChange={setQuitarFondo} />
        </div>
        <input ref={archivo} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void reemplazarImagen(capa, f, quitarFondo); e.target.value = ''; }} />
        {capa.maskSrc && (
          <Boton titulo="Elimina la máscara y vuelve a mostrar toda la imagen" onClick={() => up({ maskSrc: null })}>Quitar máscara</Boton>
        )}
      </Seccion>
      <Seccion titulo="Ajustes" abierta={false}>
        <Deslizador etiqueta="Brillo" valor={a.brightness} min={-100} max={100} clave="br" onChange={(v, k) => setA({ brightness: v }, k)} />
        <Deslizador etiqueta="Contraste" valor={a.contrast} min={-100} max={100} clave="ct" onChange={(v, k) => setA({ contrast: v }, k)} />
        <Deslizador etiqueta="Saturación" valor={a.saturation} min={-100} max={100} clave="sat" onChange={(v, k) => setA({ saturation: v }, k)} />
        <Deslizador etiqueta="Temperatura" valor={a.temperature} min={-100} max={100} clave="temp" onChange={(v, k) => setA({ temperature: v }, k)} />
        <Deslizador etiqueta="Nitidez" valor={a.sharpen} min={0} max={100} clave="nit" onChange={(v, k) => setA({ sharpen: v }, k)} />
        <Deslizador etiqueta="Desenfoque" valor={a.blur} min={0} max={40} clave="des" onChange={(v, k) => setA({ blur: v }, k)} />
        <Selector etiqueta="Filtro" valor={a.filter} opciones={FILTROS} onChange={(v) => setA({ filter: v }, 'filtro')} />
        <Boton onClick={() => up({ adjustments: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, sharpen: 0, blur: 0, filter: 'none' } })}>Restablecer ajustes</Boton>
      </Seccion>
      <Seccion titulo="Efectos" abierta={ef.outline.enabled || ef.glow.enabled || ef.shadow.enabled}>
        <Interruptor etiqueta="Contorno alrededor del recorte" valor={ef.outline.enabled} onChange={(v) => up({ effects: { ...ef, outline: { ...ef.outline, enabled: v } } })} />
        {ef.outline.enabled && (
          <>
            <SelectorColor etiqueta="Color" valor={ef.outline.color} clave="olc" onChange={(c, k) => up({ effects: { ...ef, outline: { ...ef.outline, color: c } } }, k)} />
            <Deslizador etiqueta="Grosor" valor={ef.outline.width} min={1} max={60} clave="olw" onChange={(v, k) => up({ effects: { ...ef, outline: { ...ef.outline, width: v } } }, k)} />
          </>
        )}
        <Interruptor etiqueta="Resplandor de borde" valor={ef.glow.enabled} onChange={(v) => up({ effects: { ...ef, glow: { ...ef.glow, enabled: v } } })} />
        {ef.glow.enabled && (
          <>
            <SelectorColor etiqueta="Color" valor={ef.glow.color} clave="glc" onChange={(c, k) => up({ effects: { ...ef, glow: { ...ef.glow, color: c } } }, k)} />
            <Deslizador etiqueta="Tamaño" valor={ef.glow.blur} min={2} max={120} clave="glb" onChange={(v, k) => up({ effects: { ...ef, glow: { ...ef.glow, blur: v } } }, k)} />
            <Deslizador etiqueta="Intensidad" valor={ef.glow.strength} min={0.1} max={2} paso={0.05} clave="gls" onChange={(v, k) => up({ effects: { ...ef, glow: { ...ef.glow, strength: v } } }, k)} />
          </>
        )}
        <EditorSombra titulo="Sombra" valor={ef.shadow} clave="isombra" onChange={(s, k) => up({ effects: { ...ef, shadow: s } }, k)} />
      </Seccion>
    </>
  );
}

// ------------------------------------------------------------------ formas

function PropsForma({ capa }: { capa: ShapeLayer }) {
  const up = (c: Partial<ShapeLayer>, clave?: string) => st().actualizarCapa(capa.id, c, clave);
  return (
    <Seccion titulo="Forma">
      <Selector
        etiqueta="Tipo"
        valor={capa.shapeType}
        opciones={[
          { v: 'rect', t: 'Rectángulo' },
          { v: 'ellipse', t: 'Círculo / elipse' },
          { v: 'arrow', t: 'Flecha' },
          { v: 'band', t: 'Banda' },
          { v: 'badge', t: 'Insignia' },
          { v: 'star', t: 'Estrella' },
          { v: 'line', t: 'Línea' },
        ]}
        onChange={(v) => up({ shapeType: v })}
      />
      <div className="grid grid-cols-2 gap-2">
        <Numero etiqueta="Ancho" valor={capa.width} onChange={(v) => up({ width: Math.max(2, v) }, 'fw')} />
        <Numero etiqueta="Alto" valor={capa.height} onChange={(v) => up({ height: Math.max(2, v) }, 'fh')} />
      </div>
      <EditorRelleno valor={capa.fill} clave="frelleno" onChange={(f, k) => up({ fill: f }, k)} />
      <SelectorColor etiqueta="Contorno" valor={capa.stroke.color} clave="fsc" onChange={(c, k) => up({ stroke: { ...capa.stroke, color: c } }, k)} />
      <Deslizador etiqueta="Grosor contorno" valor={capa.stroke.width} min={0} max={60} clave="fsw" onChange={(v, k) => up({ stroke: { ...capa.stroke, width: v } }, k)} />
      {capa.shapeType === 'rect' && <Deslizador etiqueta="Esquinas" valor={capa.cornerRadius} min={0} max={Math.min(capa.width, capa.height) / 2} clave="fcr" onChange={(v, k) => up({ cornerRadius: v }, k)} />}
      {(capa.shapeType === 'badge' || capa.shapeType === 'star') && <Deslizador etiqueta="Puntas" valor={capa.points ?? 5} min={3} max={40} clave="fpt" onChange={(v, k) => up({ points: v }, k)} />}
      <EditorSombra titulo="Sombra" valor={capa.shadow} clave="fsombra" onChange={(s, k) => up({ shadow: s }, k)} />
    </Seccion>
  );
}
