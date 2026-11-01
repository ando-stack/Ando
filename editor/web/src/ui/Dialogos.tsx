import JSZip from 'jszip';
import { Cloud, Info, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { anadirSuperposicion, importarImagen } from '../acciones';
import { api, type ResumenProyecto, type Trabajo } from '../api';
import { cargarImagen } from '../canvas/componer';
import { renderizar } from '../canvas/refs';
import { docVacio, nuevaImagen } from '../defaults';
import { FORMATOS, formatoPorId } from '../formats';
import { useEditor } from '../store';
import type { ImageLayer } from '../types';
import { ajustarCalidad, descargar, formatoBytes, lienzoABlob, nombreArchivo, type TipoExport } from '../utils/exportar';
import { recolocar } from '../utils/relayout';
import { abrirProyecto } from '../proyecto';
import { Boton, Interruptor, Modal, Selector } from './controles';

const st = () => useEditor.getState();
const cerrar = () => st().set({ dialogo: null });

// ------------------------------------------------------------------ inicio / proyectos

export function DialogoInicio() {
  const [lista, setLista] = useState<ResumenProyecto[] | null>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const [formato, setFormato] = useState('yt-movil');
  const recargar = () => api.proyectos().then(setLista).catch(() => setLista([]));
  useEffect(() => {
    void recargar();
  }, []);
  const nuevo = async () => {
    const f = formatoPorId(formato)!;
    const d = { ...docVacio(f.ancho, f.alto, 'Diseño nuevo'), formatId: f.id };
    try {
      const r = await api.crearProyecto(d);
      await abrirProyecto(r.id);
      cerrar();
    } catch (e) {
      st().avisar((e as Error).message, 'error');
    }
  };
  return (
    <Modal titulo="Estudio de Capas" onCerrar={() => st().doc.id && cerrar()} ancho="max-w-3xl">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div
            className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-acento/60 p-6 text-center hover:bg-acento/10"
            onClick={() => archivo.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) st().set({ dialogo: 'descomponer', archivoPendiente: f });
            }}
            data-testid="zona-subida"
          >
            <Upload />
            <div className="text-sm font-semibold">Sube una imagen de inspiración</div>
            <div className="text-xs text-tenue">JPG, PNG o WebP. La IA la separa en capas editables (fondo, personas, objetos, textos y gráficos). Todo se procesa en tu equipo.</div>
          </div>
          <input
            ref={archivo}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            data-testid="input-subida"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) st().set({ dialogo: 'descomponer', archivoPendiente: f });
              e.target.value = '';
            }}
          />
          <div className="space-y-2 rounded-lg bg-panel2 p-3">
            <div className="text-xs font-semibold">O empieza en blanco</div>
            <Selector valor={formato} opciones={FORMATOS.map((f) => ({ v: f.id, t: `${f.nombre} (${f.ancho}×${f.alto})` }))} onChange={setFormato} />
            <Boton tipo="primario" onClick={nuevo} testid="nuevo-proyecto">Crear diseño en blanco</Boton>
          </div>
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold text-tenue">Proyectos recientes</div>
          <div className="max-h-96 space-y-1 overflow-y-auto">
            {lista === null && <p className="text-xs text-tenue">Cargando…</p>}
            {lista?.length === 0 && <p className="text-xs text-tenue">Aún no hay proyectos.</p>}
            {lista?.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded p-1 hover:bg-panel2">
                <button type="button" className="flex flex-1 items-center gap-2 text-left" onClick={async () => { await abrirProyecto(p.id); cerrar(); }}>
                  <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-black">
                    {p.thumbnail && <img src={p.thumbnail + '?t=' + Math.round(p.updatedAt)} alt="" className="h-full w-full object-contain" />}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-xs">{p.name}</div>
                    <div className="text-xxs text-tenue">{p.width}×{p.height} · {new Date(p.updatedAt * 1000).toLocaleString('es-ES')}</div>
                  </div>
                </button>
                <button
                  type="button"
                  aria-label="Borrar proyecto"
                  className="p-1 text-tenue hover:text-peligro"
                  onClick={async () => {
                    if (!window.confirm(`¿Borrar «${p.name}»? No se puede deshacer.`)) return;
                    await api.borrarProyecto(p.id);
                    void recargar();
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ descomposición

export function DialogoDescomponer() {
  const archivo = useEditor((s) => s.archivoPendiente);
  const [trabajo, setTrabajo] = useState<Trabajo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const iniciado = useRef(false);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  useEffect(() => {
    if (!archivo || iniciado.current) return;
    iniciado.current = true;
    (async () => {
      try {
        const r = await api.descomponer(archivo);
        r.avisos.forEach((a) => st().avisar(a, 'aviso'));
        while (montado.current) {
          const t = await api.trabajo(r.trabajo);
          setTrabajo(t);
          if (t.estado === 'listo') {
            await abrirProyecto(r.proyecto);
            st().set({ dialogo: null, archivoPendiente: null });
            st().avisar('Imagen separada en capas. Revisa las capas con confianza baja (punto ámbar o rojo).', 'ok');
            return;
          }
          if (t.estado === 'error') {
            setError(t.mensaje);
            return;
          }
          await new Promise((ok) => setTimeout(ok, 700));
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [archivo]);
  return (
    <Modal titulo="Separando la imagen en capas" onCerrar={() => (error ? st().set({ dialogo: 'inicio' }) : undefined)}>
      <div className="space-y-3">
        <div className="flex gap-2 rounded border border-borde bg-panel2 p-2 text-xs text-tenue" data-testid="aviso-derechos">
          <Info size={16} className="shrink-0 text-acento" />
          <span>Si la imagen es de otra persona, úsala como inspiración y sustituye fotos, logotipos y textos por los tuyos antes de publicar.</span>
        </div>
        {!error && (
          <>
            <div className="h-2 overflow-hidden rounded bg-panel2">
              <div className="h-full bg-acento transition-all" style={{ width: `${Math.round((trabajo?.progreso ?? 0.02) * 100)}%` }} />
            </div>
            <p className="text-xs">{trabajo?.mensaje ?? 'Enviando la imagen al motor local…'}</p>
            <p className="text-xxs text-tenue">En un ordenador sin GPU tarda entre 30 y 90 segundos.</p>
          </>
        )}
        {error && (
          <>
            <p className="text-sm text-peligro">{error}</p>
            <Boton onClick={() => st().set({ dialogo: 'inicio' })}>Volver</Boton>
          </>
        )}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ importar imagen

export function DialogoImportar() {
  const [quitar, setQuitar] = useState(true);
  const archivo = useRef<HTMLInputElement>(null);
  return (
    <Modal titulo="Importar imagen propia" onCerrar={cerrar}>
      <div className="space-y-3 text-sm">
        <p className="text-xs text-tenue">Añade una foto (por ejemplo, la de un jugador o la tuya). Se procesa en tu equipo.</p>
        <Interruptor etiqueta="Quitar el fondo automáticamente (IA local)" valor={quitar} onChange={setQuitar} />
        <Boton tipo="primario" onClick={() => archivo.current?.click()} testid="elegir-imagen">Elegir imagen…</Boton>
        <input
          ref={archivo}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          data-testid="input-importar"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              cerrar();
              void importarImagen(f, quitar);
            }
            e.target.value = '';
          }}
        />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ formatos

export function DialogoFormatos() {
  const { doc } = useEditor();
  const [w, setW] = useState(doc.width);
  const [h, setH] = useState(doc.height);
  const [recolocarCapas, setRecolocar] = useState(true);
  const aplicar = (f: { ancho: number; alto: number; id?: string }) => {
    st().cambiar((d) => ({ ...(recolocarCapas ? recolocar(d, f.ancho, f.alto) : { ...d, width: f.ancho, height: f.alto }), formatId: f.id }));
    cerrar();
    setTimeout(() => window.dispatchEvent(new Event('estudio:encuadrar')), 50);
  };
  return (
    <Modal titulo="Formato del lienzo" onCerrar={cerrar} ancho="max-w-xl">
      <div className="space-y-2">
        {FORMATOS.map((f) => (
          <button key={f.id} type="button" data-testid={`formato-${f.id}`} onClick={() => aplicar(f)} className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-panel2 ${doc.formatId === f.id ? 'ring-1 ring-acento' : ''}`}>
            <span>
              {f.nombre}
              <span className="block text-xxs text-tenue">{f.nota}</span>
            </span>
            <span className="text-xs text-tenue">{f.ancho} × {f.alto}</span>
          </button>
        ))}
        <div className="flex items-end gap-2 border-t border-borde pt-3 text-xs">
          <label>Ancho <input type="number" className="w-20 rounded bg-panel2 px-1" value={w} onChange={(e) => setW(Number(e.target.value))} /></label>
          <label>Alto <input type="number" className="w-20 rounded bg-panel2 px-1" value={h} onChange={(e) => setH(Number(e.target.value))} /></label>
          <Boton onClick={() => w >= 16 && h >= 16 && w <= 10000 && h <= 10000 && aplicar({ ancho: Math.round(w), alto: Math.round(h) })}>Aplicar tamaño</Boton>
        </div>
        <Interruptor etiqueta="Recolocar las capas automáticamente (punto de partida editable)" valor={recolocarCapas} onChange={setRecolocar} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ exportar

export function DialogoExportar() {
  const { doc } = useEditor();
  const fmt = formatoPorId(doc.formatId);
  const [tipo, setTipo] = useState<TipoExport>(fmt?.id.startsWith('yt') ? 'jpg' : 'png');
  const [calidad, setCalidad] = useState(0.92);
  const [respetar, setRespetar] = useState(true);
  const [maxMb, setMaxMb] = useState<number>(fmt?.maxBytes ? fmt.maxBytes / 1024 / 1024 : 0);
  const [resultado, setResultado] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const maxBytes = respetar && maxMb > 0 ? maxMb * 1024 * 1024 : null;

  const exportar = async () => {
    setTrabajando(true);
    setResultado(null);
    try {
      const c = renderizar(doc);
      let blob: Blob;
      let nota = '';
      if (tipo === 'png') {
        blob = await lienzoABlob(c, 'png', 1);
        if (maxBytes && blob.size > maxBytes) {
          blob = await api.optimizarPng(blob, maxBytes);
          nota = ' (colores reducidos para no superar el peso máximo)';
        }
      } else if (maxBytes) {
        const r = await ajustarCalidad((q) => lienzoABlob(c, tipo, q), maxBytes, calidad);
        blob = r.resultado;
        if (r.calidad < calidad) nota = ` (calidad ajustada a ${Math.round(r.calidad * 100)}% para no superar ${maxMb} MB)`;
        if (!r.cabe) nota = ' — ¡aviso! ni con la calidad mínima cabe en el peso máximo';
      } else blob = await lienzoABlob(c, tipo, calidad);
      descargar(blob, `${nombreArchivo(doc.name)}_${doc.width}x${doc.height}.${tipo}`);
      setResultado(`Exportado: ${doc.width}×${doc.height} px, ${formatoBytes(blob.size)}${nota}.`);
    } catch (e) {
      setResultado((e as Error).message);
    } finally {
      setTrabajando(false);
    }
  };

  const exportarCapas = async () => {
    setTrabajando(true);
    try {
      const zip = new JSZip();
      let i = 0;
      for (const l of [...doc.layers].reverse()) {
        if (!l.visible || l.role === 'original') continue;
        const c = renderizar(doc, { ids: [l.id] });
        const b = await lienzoABlob(c, 'png', 1);
        i++;
        zip.file(`${String(i).padStart(2, '0')}_${nombreArchivo(l.name)}.png`, b);
      }
      const b = await zip.generateAsync({ type: 'blob' });
      descargar(b, `${nombreArchivo(doc.name)}_capas.zip`);
      setResultado(`${i} capas exportadas como PNG con transparencia (a tamaño del lienzo).`);
    } catch (e) {
      setResultado((e as Error).message);
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <Modal titulo="Exportar" onCerrar={cerrar}>
      <div className="space-y-3 text-xs">
        <div className="text-tenue">
          Lienzo: {doc.width}×{doc.height} px {fmt ? `· ${fmt.nombre}` : ''}
        </div>
        <Selector etiqueta="Formato" valor={tipo} opciones={[{ v: 'png', t: 'PNG (sin pérdida, transparencia)' }, { v: 'jpg', t: 'JPG' }, { v: 'webp', t: 'WebP' }]} onChange={setTipo} />
        {tipo !== 'png' && (
          <label className="flex items-center gap-2">
            <span className="w-24 text-tenue">Calidad</span>
            <input type="range" min={0.4} max={1} step={0.01} value={calidad} className="flex-1 accent-acento" onChange={(e) => setCalidad(Number(e.target.value))} />
            <span className="w-10 text-right">{Math.round(calidad * 100)}%</span>
          </label>
        )}
        <div className="flex items-center gap-2">
          <Interruptor etiqueta="Respetar peso máximo" valor={respetar} onChange={setRespetar} />
          <input type="number" min={0} step={0.5} className="w-16 rounded bg-panel2 px-1" value={maxMb} onChange={(e) => setMaxMb(Number(e.target.value))} />
          <span className="text-tenue">MB</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Boton tipo="primario" deshabilitado={trabajando} onClick={exportar} testid="exportar-ahora">Exportar imagen</Boton>
          <Boton deshabilitado={trabajando} onClick={exportarCapas}>Exportar capas por separado (ZIP)</Boton>
          {fmt?.previsualizacionMovil && <Boton onClick={() => st().set({ dialogo: 'previa' })}>Vista previa en móvil</Boton>}
        </div>
        {resultado && <p className="rounded bg-panel2 p-2" data-testid="resultado-export">{resultado}</p>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ vista previa móvil

export function DialogoPrevia() {
  const { doc } = useEditor();
  const [url, setUrl] = useState<string>('');
  const [oscuro, setOscuro] = useState(true);
  useEffect(() => {
    const c = renderizar(doc, { escala: Math.min(1, 720 / doc.width) });
    setUrl(c.toDataURL('image/jpeg', 0.85));
  }, [doc]);
  const proporcion = `${doc.width} / ${doc.height}`;
  const neutras = useMemo(() => ['#5b5f66', '#4a4e55', '#6b6f76', '#55595f', '#62666d'], []);
  const fondo = oscuro ? 'bg-[#0f0f0f] text-white' : 'bg-white text-black';
  const tarjeta = (src: string | null, i: number, ancho: string) => (
    <div key={i} className="flex gap-2">
      <div className={`relative shrink-0 overflow-hidden rounded-lg ${ancho}`} style={{ aspectRatio: proporcion, background: src ? undefined : neutras[i % neutras.length] }}>
        {src && <img src={src} alt="Tu miniatura" className="h-full w-full object-cover" />}
        <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[9px] text-white">12:34</span>
      </div>
      <div className="min-w-0 flex-1 space-y-1 pt-0.5">
        <div className={`h-2.5 w-11/12 rounded ${oscuro ? 'bg-white/30' : 'bg-black/20'}`} />
        <div className={`h-2.5 w-2/3 rounded ${oscuro ? 'bg-white/30' : 'bg-black/20'}`} />
        <div className={`h-2 w-1/2 rounded ${oscuro ? 'bg-white/15' : 'bg-black/10'}`} />
      </div>
    </div>
  );
  return (
    <Modal titulo="Vista previa: cómo se ve en el móvil" onCerrar={cerrar} ancho="max-w-4xl">
      <div className="mb-3 flex items-center gap-3 text-xs">
        <Interruptor etiqueta="Tema oscuro" valor={oscuro} onChange={setOscuro} />
        <span className="text-tenue">La marca de duración (abajo a la derecha) tapa esa zona en YouTube.</span>
      </div>
      <div className="grid gap-6 md:grid-cols-2" data-testid="vista-movil">
        <div>
          <div className="mb-1 text-xs text-tenue">Inicio (móvil, ancho completo ≈ 360 px)</div>
          <div className={`mx-auto w-[360px] space-y-3 rounded-2xl border-4 border-black p-0 ${fondo}`}>
            {[0, 1].map((i) => (
              <div key={i}>
                <div className="relative w-full overflow-hidden" style={{ aspectRatio: proporcion, background: i === 0 ? undefined : neutras[2] }}>
                  {i === 0 && url && <img src={url} alt="Tu miniatura" className="h-full w-full object-cover" />}
                  <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[10px] text-white">12:34</span>
                </div>
                <div className="flex gap-2 p-2">
                  <div className={`h-8 w-8 shrink-0 rounded-full ${oscuro ? 'bg-white/25' : 'bg-black/15'}`} />
                  <div className="flex-1 space-y-1">
                    <div className={`h-2.5 w-11/12 rounded ${oscuro ? 'bg-white/30' : 'bg-black/20'}`} />
                    <div className={`h-2 w-1/2 rounded ${oscuro ? 'bg-white/15' : 'bg-black/10'}`} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs text-tenue">Resultados de búsqueda / sugeridos (≈ 168 px de ancho)</div>
          <div className={`mx-auto w-[360px] space-y-3 rounded-2xl border-4 border-black p-3 ${fondo}`}>
            {[null, null, url, null, null].map((s, i) => tarjeta(s, i, 'w-[168px]'))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ nube (opcional)

export function DialogoNube() {
  const { doc, seleccion } = useEditor();
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.nube>> | null>(null);
  const [prompt, setPrompt] = useState('');
  const [modo, setModo] = useState<'ampliar' | 'generar'>('ampliar');
  const [confirmo, setConfirmo] = useState(false);
  const [margen, setMargen] = useState(25);
  const capa = (doc.layers.find((l) => l.id === seleccion[0] && l.type === 'image') ?? [...doc.layers].reverse().find((l) => l.role === 'fondo')) as ImageLayer | undefined;
  useEffect(() => {
    api.nube(doc.width, doc.height).then(setInfo).catch((e) => st().avisar((e as Error).message, 'error'));
  }, [doc.width, doc.height]);
  const enviar = async () => {
    if (!capa) return;
    st().set({ ocupado: 'Enviando la imagen a la nube…' });
    try {
      const im = await cargarImagen(capa.src);
      const px = Math.round((im.width * margen) / 100 / 2);
      const py = Math.round((im.height * margen) / 100 / 2);
      if (modo === 'ampliar') {
        const r = await api.rellenoGenerativo({ proyecto: doc.id, recurso: capa.src, prompt, ampliar: { izquierda: px, derecha: px, arriba: py, abajo: py }, confirmado: true });
        const kx = capa.width / im.width;
        const ky = capa.height / im.height;
        st().actualizarCapa(capa.id, { src: r.url, width: r.width * kx, height: r.height * ky, x: capa.x - px * kx * capa.scaleX, y: capa.y - py * ky * capa.scaleY, maskSrc: null } as Partial<ImageLayer>);
      } else {
        const r = await api.rellenoGenerativo({ proyecto: doc.id, recurso: capa.src, prompt, confirmado: true });
        const nueva = nuevaImagen(r.url, capa.x, capa.y, capa.width, capa.height, `IA: ${prompt.slice(0, 20)}`, 'usuario');
        st().anadirCapa(nueva, capa.id);
      }
      cerrar();
      st().avisar('Imagen generada en la nube.', 'ok');
    } catch (e) {
      st().avisar((e as Error).message, 'error');
    } finally {
      st().set({ ocupado: null });
    }
  };
  return (
    <Modal titulo="Relleno generativo en la nube (opcional)" onCerrar={cerrar}>
      <div className="space-y-3 text-xs">
        <div className="flex gap-2 rounded border border-aviso/60 bg-aviso/10 p-2 text-aviso">
          <Cloud size={16} className="shrink-0" />
          <span>
            <b>Esta función envía la imagen a un servicio externo ({info?.proveedor ?? 'OpenAI'}).</b> Todo lo demás del editor funciona en tu equipo. Coste aproximado:{' '}
            <b>{info?.coste.usd_por_imagen != null ? `${info.coste.usd_por_imagen.toFixed(3)} USD por imagen` : 'desconocido'}</b> ({info?.modelo}, calidad {info?.calidad}, {info?.coste.tamano}). {info?.coste.nota}
          </span>
        </div>
        {!info?.activada && (
          <p className="rounded bg-panel2 p-2 text-tenue">
            Desactivada. Para usarla: copia <code>.env.example</code> a <code>.env</code>, pon <code>NUBE_ACTIVADA=true</code> y tu <code>OPENAI_API_KEY</code>, y reinicia el motor.
            {info?.solicitada && !info.hay_clave && ' (Falta la clave.)'}
          </p>
        )}
        {info?.activada && (
          <>
            <Selector etiqueta="Qué hacer" valor={modo} opciones={[{ v: 'ampliar', t: 'Ampliar el fondo (más espacio alrededor)' }, { v: 'generar', t: 'Generar un elemento nuevo / variación' }]} onChange={setModo} />
            {modo === 'ampliar' && (
              <label className="flex items-center gap-2">
                <span className="w-24 text-tenue">Ampliar un</span>
                <input type="range" min={10} max={80} value={margen} className="flex-1 accent-acento" onChange={(e) => setMargen(Number(e.target.value))} />
                <span>{margen}%</span>
              </label>
            )}
            <textarea className="h-20 w-full rounded bg-panel2 p-2" placeholder="Describe lo que quieres (p. ej. «estadio de fútbol de noche con focos»)" value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            <p className="text-tenue">Capa: {capa?.name ?? '—'}</p>
            <Interruptor etiqueta="Entiendo que la imagen se enviará a la nube y que tiene coste" valor={confirmo} onChange={setConfirmo} />
            <Boton tipo="primario" deshabilitado={!confirmo || prompt.trim().length < 3 || !capa} onClick={enviar}>Enviar a la nube</Boton>
          </>
        )}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ atajos

export const ATAJOS: [string, string][] = [
  ['V', 'Seleccionar / mover'],
  ['H o mantener Espacio', 'Mano (desplazar el lienzo)'],
  ['T', 'Texto'],
  ['U', 'Formas'],
  ['E / B', 'Borrador de máscara / pincel de máscara'],
  ['J', 'Borrar objeto con IA'],
  ['S', 'Segmentar zona'],
  ['I', 'Cuentagotas'],
  ['[ y ]', 'Tamaño del pincel'],
  ['Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y', 'Deshacer / rehacer'],
  ['Ctrl+D', 'Duplicar'],
  ['Supr / Retroceso', 'Eliminar capa'],
  ['Ctrl+G / Ctrl+Shift+G', 'Agrupar / desagrupar'],
  ['Ctrl+E', 'Unir capas seleccionadas'],
  ['Ctrl+] / Ctrl+[', 'Subir / bajar capa (con Shift: al frente / al fondo)'],
  ['Flechas (Shift ×10)', 'Mover 1 px (10 px)'],
  ['Shift+H / Shift+V', 'Voltear horizontal / vertical'],
  ['Shift al girar', 'Girar en pasos (encaje a 45°)'],
  ['Ctrl+A', 'Seleccionar todo'],
  ['Ctrl+0 / Ctrl+1', 'Encajar en pantalla / zoom 100%'],
  ['Ctrl + rueda, + / −', 'Zoom'],
  ["Ctrl+'", 'Mostrar cuadrícula'],
  ['Ctrl+R', 'Mostrar reglas'],
  ['Ctrl+S', 'Guardar ahora'],
  ['Ctrl+Shift+E', 'Exportar'],
  ['Doble clic en un texto', 'Editar el texto en el lienzo'],
  ['Esc', 'Deseleccionar / cancelar'],
  ['?', 'Ver los atajos'],
];

export function DialogoAtajos() {
  return (
    <Modal titulo="Atajos de teclado" onCerrar={cerrar}>
      <table className="w-full text-xs">
        <tbody>
          {ATAJOS.map(([k, d]) => (
            <tr key={k} className="border-b border-borde/50">
              <td className="py-1 pr-3 font-mono text-acento">{k}</td>
              <td className="py-1">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

// ------------------------------------------------------------------ efectos (recursos libres)

export function PanelEfectos() {
  const [rec, setRec] = useState<{ overlays: string[]; textures: string[] } | null>(null);
  useEffect(() => {
    api.recursosLibres().then(setRec).catch(() => setRec({ overlays: [], textures: [] }));
  }, []);
  const nombre = (u: string) => decodeURIComponent(u.split('/').pop()!.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '));
  const modo = (u: string): ImageLayer['blendMode'] => (/(grano|semitono|halftone|textura|papel)/i.test(u) ? 'overlay' : 'screen');
  return (
    <div className="space-y-3 p-3 text-xs">
      <p className="text-tenue">Recursos propios con licencia libre (CC0). Se añaden a tamaño completo con un modo de fusión adecuado; ajusta la opacidad en el panel de capas.</p>
      {(['overlays', 'textures'] as const).map((tipo) => (
        <div key={tipo}>
          <div className="mb-1 font-semibold">{tipo === 'overlays' ? 'Luces, destellos y humo' : 'Texturas (grano, semitono)'}</div>
          <div className="grid grid-cols-2 gap-2">
            {rec?.[tipo].map((u) => (
              <button key={u} type="button" title={nombre(u)} onClick={() => void anadirSuperposicion(u, nombre(u), modo(u))} className="overflow-hidden rounded border border-borde bg-black hover:border-acento">
                <img src={u} alt={nombre(u)} className="h-14 w-full object-cover" />
                <div className="truncate px-1 py-0.5 text-left text-xxs">{nombre(u)}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}


