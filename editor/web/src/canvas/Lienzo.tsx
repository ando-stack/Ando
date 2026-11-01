import type { JSX } from 'react';
import Konva from 'konva';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Group, Image as KImage, Layer as KLayer, Line, Rect, Stage, Transformer, Circle } from 'react-konva';
import { api } from '../api';
import { nuevaForma, nuevoTexto } from '../defaults';
import { useEditor } from '../store';
import type { ImageLayer, Layer, TextLayer } from '../types';
import { cargarImagen } from './componer';
import { avisarMascara, mascarasEnVivo, NodoCapa } from './nodes';
import { capaDesdeRecorte, docANatural, esImagen, refs, useSegmento } from './refs';
import { Reglas, TAM_REGLA } from './Reglas';

const SNAP_PX = 6;

interface Trazo {
  modo: 'mask-hide' | 'mask-show' | 'ai-erase' | 'segment';
  puntos: number[]; // coordenadas del documento
  capaId: string;
}

export function Lienzo() {
  const contRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const contenidoRef = useRef<Konva.Group>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [tam, setTam] = useState({ w: 800, h: 600 });
  const e = useEditor();
  const { doc, seleccion, herramienta, zoom, pan } = e;
  const seg = useSegmento();
  const [espacio, setEspacio] = useState(false);
  const [guiasInteligentes, setGuiasInteligentes] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [banda, setBanda] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [formaPrevia, setFormaPrevia] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [trazo, setTrazo] = useState<Trazo | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [imgPrevia, setImgPrevia] = useState<HTMLImageElement | null>(null);
  const arrastre = useRef<{ inicio: Map<string, { x: number; y: number }>; principal: string } | null>(null);
  const paneo = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const mascaraTrabajo = useRef<{ canvas: HTMLCanvasElement; natW: number; natH: number; capa: ImageLayer; ultimo: { x: number; y: number } | null } | null>(null);

  // ------------------------------------------------------------ tamaño y encuadre
  useLayoutEffect(() => {
    const el = contRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTam({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setTam({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const encuadrar = useCallback(() => {
    const m = 60;
    const z = Math.min((tam.w - m * 2) / doc.width, (tam.h - m * 2) / doc.height, 4);
    e.set({ zoom: z, pan: { x: (tam.w - doc.width * z) / 2, y: (tam.h - doc.height * z) / 2 } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tam.w, tam.h, doc.width, doc.height]);

  useEffect(() => {
    encuadrar();
    // encuadra al abrir otro documento o cambiar de formato
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, doc.width, doc.height, tam.w > 0]);

  useEffect(() => {
    const f = () => encuadrar();
    window.addEventListener('estudio:encuadrar', f);
    return () => window.removeEventListener('estudio:encuadrar', f);
  }, [encuadrar]);

  useEffect(() => {
    refs.stage = stageRef.current;
    refs.contenido = contenidoRef.current;
    refs.transformer = trRef.current;
  });

  // ------------------------------------------------------------ teclado (espacio = mano)
  useEffect(() => {
    const abajo = (ev: KeyboardEvent) => {
      if (ev.code === 'Space' && !(ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement)) {
        ev.preventDefault();
        setEspacio(true);
      }
    };
    const arriba = (ev: KeyboardEvent) => ev.code === 'Space' && setEspacio(false);
    window.addEventListener('keydown', abajo);
    window.addEventListener('keyup', arriba);
    return () => {
      window.removeEventListener('keydown', abajo);
      window.removeEventListener('keyup', arriba);
    };
  }, []);

  // ------------------------------------------------------------ transformador
  const herramientaEfectiva = espacio ? 'hand' : herramienta;
  useEffect(() => {
    const tr = trRef.current;
    const cont = contenidoRef.current;
    if (!tr || !cont) return;
    const nodos = herramientaEfectiva === 'select' && !editando
      ? seleccion
          .map((id) => doc.layers.find((l) => l.id === id))
          .filter((l): l is Layer => !!l && l.visible && !l.locked)
          .map((l) => cont.findOne('#' + l.id))
          .filter((n): n is Konva.Node => !!n)
      : [];
    tr.nodes(nodos);
    const soloFormas = nodos.length === 1 && doc.layers.find((l) => l.id === nodos[0].id())?.type === 'shape';
    tr.keepRatio(!soloFormas);
    tr.getLayer()?.batchDraw();
  }, [seleccion, doc.layers, herramientaEfectiva, editando]);

  // capas arrastrables / clicables
  useEffect(() => {
    const cont = contenidoRef.current;
    if (!cont) return;
    for (const l of doc.layers) {
      const n = cont.findOne('#' + l.id);
      if (!n) continue;
      n.draggable(herramientaEfectiva === 'select' && !l.locked);
      n.listening(!l.locked && herramientaEfectiva !== 'hand');
    }
  });

  // vista previa de segmentación
  useEffect(() => {
    if (!seg.previa) {
      setImgPrevia(null);
      return;
    }
    cargarImagen(seg.previa.src).then(setImgPrevia).catch(() => setImgPrevia(null));
  }, [seg.previa]);

  // ------------------------------------------------------------ utilidades de coordenadas
  const puntoDoc = () => {
    const st = stageRef.current;
    const p = st?.getPointerPosition();
    if (!st || !p) return null;
    return { x: (p.x - pan.x) / zoom, y: (p.y - pan.y) / zoom };
  };

  const capaDeEvento = (target: Konva.Node): string | null => {
    let n: Konva.Node | null = target;
    while (n && !n.hasName('capa')) n = n.getParent();
    return n ? n.id() : null;
  };

  // ------------------------------------------------------------ rueda: zoom y desplazamiento
  const onWheel = (ev: Konva.KonvaEventObject<WheelEvent>) => {
    ev.evt.preventDefault();
    const st = stageRef.current;
    if (!st) return;
    if (ev.evt.ctrlKey || ev.evt.metaKey) {
      const p = st.getPointerPosition()!;
      const factor = Math.exp(-ev.evt.deltaY * 0.0015);
      const z = Math.min(16, Math.max(0.03, zoom * factor));
      e.set({ zoom: z, pan: { x: p.x - ((p.x - pan.x) / zoom) * z, y: p.y - ((p.y - pan.y) / zoom) * z } });
    } else {
      e.set({ pan: { x: pan.x - ev.evt.deltaX, y: pan.y - ev.evt.deltaY } });
    }
  };

  // ------------------------------------------------------------ pinceles
  const capaObjetivo = (para: 'mascara' | 'borrar' | 'segmentar'): ImageLayer | null => {
    const sel = doc.layers.find((l) => l.id === seleccion[0]);
    if (seleccion.length === 1 && sel) {
      if (esImagen(sel)) return sel;
      e.avisar(para === 'mascara' ? 'Las máscaras se aplican a capas de imagen. Usa «Rasterizar» para convertir esta capa.' : 'Selecciona una capa de imagen (o ninguna para usar el fondo).', 'aviso');
      return null;
    }
    if (para === 'mascara') {
      e.avisar('Selecciona primero la capa de imagen a la que quieres aplicar la máscara.', 'aviso');
      return null;
    }
    const pref = para === 'segmentar' ? ['original', 'fondo'] : ['fondo'];
    for (const rol of pref) {
      const c = [...doc.layers].reverse().find((l) => l.role === rol && l.type === 'image');
      if (c) return c as ImageLayer;
    }
    const c = doc.layers.find((l) => l.type === 'image');
    if (!c) e.avisar('No hay ninguna capa de imagen.', 'aviso');
    return (c as ImageLayer) ?? null;
  };

  const sellar = (p: { x: number; y: number }) => {
    const mt = mascaraTrabajo.current;
    if (!mt) return;
    const ctx = mt.canvas.getContext('2d')!;
    const n = docANatural(mt.capa, mt.natW, mt.natH, p);
    const escala = mt.natW / (mt.capa.width * Math.abs(mt.capa.scaleX));
    const r = (e.pincel.tam / 2) * escala;
    const pintar = (q: { x: number; y: number }) => {
      const g = ctx.createRadialGradient(q.x, q.y, r * e.pincel.dureza, q.x, q.y, r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    ctx.globalCompositeOperation = trazo?.modo === 'mask-hide' ? 'destination-out' : 'source-over';
    const u = mt.ultimo;
    if (u) {
      const d = Math.hypot(n.x - u.x, n.y - u.y);
      const pasos = Math.max(1, Math.ceil(d / Math.max(1, r * 0.25)));
      for (let i = 1; i <= pasos; i++) pintar({ x: u.x + ((n.x - u.x) * i) / pasos, y: u.y + ((n.y - u.y) * i) / pasos });
    } else pintar(n);
    mt.ultimo = n;
  };

  const iniciarPincel = async (modo: Trazo['modo'], p: { x: number; y: number }) => {
    const capa = capaObjetivo(modo === 'ai-erase' ? 'borrar' : modo === 'segment' ? 'segmentar' : 'mascara');
    if (!capa) return;
    const im = await cargarImagen(capa.src);
    const c = document.createElement('canvas');
    c.width = im.width;
    c.height = im.height;
    const ctx = c.getContext('2d')!;
    if (modo === 'mask-hide' || modo === 'mask-show') {
      if (capa.maskSrc) ctx.drawImage(await cargarImagen(capa.maskSrc), 0, 0, c.width, c.height);
      else {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
      }
      mascarasEnVivo.set(capa.id, c);
    }
    mascaraTrabajo.current = { canvas: c, natW: im.width, natH: im.height, capa, ultimo: null };
    setTrazo({ modo, puntos: [p.x, p.y], capaId: capa.id });
  };

  const terminarPincel = async () => {
    const t = trazo;
    const mt = mascaraTrabajo.current;
    setTrazo(null);
    mascaraTrabajo.current = null;
    if (!t || !mt) return;
    const pid = doc.id;
    try {
      if (t.modo === 'mask-hide' || t.modo === 'mask-show') {
        const blob = await new Promise<Blob>((ok) => mt.canvas.toBlob((b) => ok(b!), 'image/png'));
        const r = await api.subirRecurso(pid, blob, 'mascara.png');
        await cargarImagen(r.url);
        e.actualizarCapa(mt.capa.id, { maskSrc: r.url });
        mascarasEnVivo.delete(mt.capa.id);
        avisarMascara();
        return;
      }
      // borrar con IA o segmentar con pincel: máscara en blanco sobre negro
      const m = document.createElement('canvas');
      m.width = mt.natW;
      m.height = mt.natH;
      const mc = m.getContext('2d')!;
      mc.fillStyle = '#000';
      mc.fillRect(0, 0, m.width, m.height);
      mc.drawImage(mt.canvas, 0, 0);
      const url = m.toDataURL('image/png');
      if (t.modo === 'ai-erase') {
        e.set({ ocupado: 'Borrando con IA (relleno inteligente local)…' });
        const r = await api.borrarIA(pid, mt.capa.src, url);
        await cargarImagen(r.url);
        e.actualizarCapa(mt.capa.id, { src: r.url });
        r.avisos?.forEach((a) => e.avisar(a, 'aviso'));
      } else {
        e.set({ ocupado: 'Recortando la zona pintada…' });
        useSegmento.getState().set({ origenId: mt.capa.id, cargando: true });
        const r = await api.segmentar({ proyecto: pid, recurso: mt.capa.src, mascara: url });
        useSegmento.getState().set({ previa: r.capa, cargando: false });
      }
    } catch (err) {
      e.avisar((err as Error).message, 'error');
      mascarasEnVivo.delete(mt.capa.id);
      avisarMascara();
      useSegmento.getState().set({ cargando: false });
    } finally {
      e.set({ ocupado: null });
    }
  };

  const clicSegmento = async (p: { x: number; y: number }, positivo: boolean) => {
    const s = useSegmento.getState();
    let origen = s.origenId ? (doc.layers.find((l) => l.id === s.origenId) as ImageLayer | undefined) : undefined;
    if (!origen) origen = capaObjetivo('segmentar') ?? undefined;
    if (!origen) return;
    const im = await cargarImagen(origen.src);
    const n = docANatural(origen, im.width, im.height, p);
    if (n.x < 0 || n.y < 0 || n.x > im.width || n.y > im.height) {
      e.avisar('Haz clic dentro de la capa que quieres segmentar.', 'aviso');
      return;
    }
    const puntos = [...(s.origenId === origen.id ? s.puntos : []), { x: n.x, y: n.y, positivo }];
    s.set({ origenId: origen.id, puntos, cargando: true });
    try {
      const r = await api.segmentar({ proyecto: doc.id, recurso: origen.src, puntos });
      useSegmento.getState().set({ previa: r.capa, cargando: false });
    } catch (err) {
      useSegmento.getState().set({ cargando: false });
      e.avisar((err as Error).message, 'error');
    }
  };

  // ------------------------------------------------------------ eventos del ratón
  const onDown = (ev: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const p = puntoDoc();
    const st = stageRef.current;
    if (!p || !st) return;
    const evt = ev.evt as MouseEvent;
    if (herramientaEfectiva === 'hand' || evt.button === 1) {
      const sp = st.getPointerPosition()!;
      paneo.current = { x: sp.x, y: sp.y, px: pan.x, py: pan.y };
      return;
    }
    if (ev.target.getParent()?.className === 'Transformer') return;
    switch (herramientaEfectiva) {
      case 'select': {
        const id = capaDeEvento(ev.target);
        if (id) {
          if (evt.shiftKey || evt.ctrlKey || evt.metaKey) e.seleccionar([id], true);
          else if (!seleccion.includes(id)) e.seleccionar(evt.altKey ? [id] : [id]);
        } else {
          if (!evt.shiftKey) e.seleccionar([]);
          setBanda({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }
        return;
      }
      case 'text': {
        const t: TextLayer = nuevoTexto(p.x, p.y - 60, 'TEXTO', 120);
        e.anadirCapa(t);
        e.setHerramienta('select');
        setTimeout(() => setEditando(t.id), 50);
        return;
      }
      case 'shape':
        setFormaPrevia({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        return;
      case 'eyedropper': {
        const tr = trRef.current;
        tr?.visible(false);
        const sp = st.getPointerPosition()!;
        const c = st.toCanvas({ x: sp.x, y: sp.y, width: 1, height: 1, pixelRatio: 1 });
        tr?.visible(true);
        const d = c.getContext('2d')!.getImageData(0, 0, 1, 1).data;
        const hex = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
        e.cuentagotas?.(hex);
        e.set({ cuentagotas: null, herramienta: 'select' });
        e.avisar(`Color tomado: ${hex}`, 'ok');
        return;
      }
      case 'segment':
        if (useSegmento.getState().modo === 'clic') {
          void clicSegmento(p, !(evt.altKey || evt.button === 2));
          return;
        }
        void iniciarPincel('segment', p);
        return;
      case 'mask-hide':
      case 'mask-show':
      case 'ai-erase':
        void iniciarPincel(herramientaEfectiva, p);
        return;
    }
  };

  const onMove = () => {
    const st = stageRef.current;
    const p = puntoDoc();
    if (!st || !p) return;
    setCursor(p);
    if (paneo.current) {
      const sp = st.getPointerPosition()!;
      e.set({ pan: { x: paneo.current.px + sp.x - paneo.current.x, y: paneo.current.py + sp.y - paneo.current.y } });
      return;
    }
    if (banda) setBanda({ ...banda, x1: p.x, y1: p.y });
    if (formaPrevia) setFormaPrevia({ ...formaPrevia, x1: p.x, y1: p.y });
    if (trazo) {
      setTrazo({ ...trazo, puntos: [...trazo.puntos, p.x, p.y] });
      if (mascaraTrabajo.current) {
        sellar(p);
        if (trazo.modo === 'mask-hide' || trazo.modo === 'mask-show') requestAnimationFrame(avisarMascara);
      }
    }
  };

  const onUp = () => {
    paneo.current = null;
    if (banda) {
      const x0 = Math.min(banda.x0, banda.x1);
      const x1 = Math.max(banda.x0, banda.x1);
      const y0 = Math.min(banda.y0, banda.y1);
      const y1 = Math.max(banda.y0, banda.y1);
      if (x1 - x0 > 3 && y1 - y0 > 3 && contenidoRef.current) {
        const ids = doc.layers
          .filter((l) => l.visible && !l.locked)
          .filter((l) => {
            const n = contenidoRef.current!.findOne('#' + l.id);
            if (!n) return false;
            const r = n.getClientRect({ relativeTo: contenidoRef.current! });
            return r.x < x1 && r.x + r.width > x0 && r.y < y1 && r.y + r.height > y0 && !(r.x <= 0 && r.y <= 0 && r.width >= doc.width && r.height >= doc.height);
          })
          .map((l) => l.id);
        e.seleccionar(ids);
      }
      setBanda(null);
    }
    if (formaPrevia) {
      let x0 = Math.min(formaPrevia.x0, formaPrevia.x1);
      let y0 = Math.min(formaPrevia.y0, formaPrevia.y1);
      let w = Math.abs(formaPrevia.x1 - formaPrevia.x0);
      let h = Math.abs(formaPrevia.y1 - formaPrevia.y0);
      if (w < 8 || h < 8) {
        w = doc.width * 0.25;
        h = e.formaActiva === 'band' || e.formaActiva === 'arrow' ? w * 0.4 : w;
        x0 -= w / 2;
        y0 -= h / 2;
      }
      e.anadirCapa(nuevaForma(e.formaActiva, x0, y0, w, h, doc.palette[1] ?? '#e3122c'));
      setFormaPrevia(null);
      e.setHerramienta('select');
    }
    if (trazo) void terminarPincel();
  };

  // ------------------------------------------------------------ arrastre con guías inteligentes
  const lineasCandidatas = (excluir: string[]) => {
    const v = [0, doc.width / 2, doc.width, ...doc.guides.x];
    const h = [0, doc.height / 2, doc.height, ...doc.guides.y];
    const cont = contenidoRef.current;
    if (cont) {
      for (const l of doc.layers) {
        if (excluir.includes(l.id) || !l.visible || l.role === 'original') continue;
        const n = cont.findOne('#' + l.id);
        if (!n) continue;
        const r = n.getClientRect({ relativeTo: cont });
        if (r.width >= doc.width * 0.98 && r.height >= doc.height * 0.98) continue;
        v.push(r.x, r.x + r.width / 2, r.x + r.width);
        h.push(r.y, r.y + r.height / 2, r.y + r.height);
      }
    }
    return { v, h };
  };

  const onDragStart = (ev: Konva.KonvaEventObject<DragEvent>) => {
    const id = capaDeEvento(ev.target);
    if (!id || ev.target.className === 'Stage') return;
    const ids = seleccion.includes(id) ? seleccion : [id];
    if (!seleccion.includes(id)) e.seleccionar([id]);
    const inicio = new Map<string, { x: number; y: number }>();
    for (const i of ids) {
      const n = contenidoRef.current?.findOne('#' + i);
      if (n) inicio.set(i, { x: n.x(), y: n.y() });
    }
    arrastre.current = { inicio, principal: id };
  };

  const onDragMove = (ev: Konva.KonvaEventObject<DragEvent>) => {
    const a = arrastre.current;
    const cont = contenidoRef.current;
    if (!a || !cont) return;
    const nodo = ev.target;
    const ids = [...a.inicio.keys()];
    // ajuste a la cuadrícula
    if (e.ajustarCuadricula) {
      const g = e.tamCuadricula;
      nodo.x(Math.round(nodo.x() / g) * g);
      nodo.y(Math.round(nodo.y() / g) * g);
    } else {
      // guías inteligentes: bordes y centros
      const { v, h } = lineasCandidatas(ids);
      const r = nodo.getClientRect({ relativeTo: cont });
      const tol = SNAP_PX / zoom;
      const xs = [r.x, r.x + r.width / 2, r.x + r.width];
      const ys = [r.y, r.y + r.height / 2, r.y + r.height];
      let dx = 0;
      let dy = 0;
      let gv: number[] = [];
      let gh: number[] = [];
      let mejorX = tol;
      let mejorY = tol;
      for (const c of v)
        for (const x of xs)
          if (Math.abs(c - x) < mejorX) {
            mejorX = Math.abs(c - x);
            dx = c - x;
            gv = [c];
          }
      for (const c of h)
        for (const y of ys)
          if (Math.abs(c - y) < mejorY) {
            mejorY = Math.abs(c - y);
            dy = c - y;
            gh = [c];
          }
      nodo.x(nodo.x() + dx);
      nodo.y(nodo.y() + dy);
      setGuiasInteligentes({ v: gv, h: gh });
    }
    const i0 = a.inicio.get(nodo.id());
    if (!i0) return;
    const ddx = nodo.x() - i0.x;
    const ddy = nodo.y() - i0.y;
    for (const [id, pos] of a.inicio) {
      if (id === nodo.id()) continue;
      cont.findOne('#' + id)?.position({ x: pos.x + ddx, y: pos.y + ddy });
    }
  };

  const onDragEnd = () => {
    const a = arrastre.current;
    arrastre.current = null;
    setGuiasInteligentes({ v: [], h: [] });
    const cont = contenidoRef.current;
    if (!a || !cont) return;
    const pos = new Map<string, { x: number; y: number }>();
    for (const id of a.inicio.keys()) {
      const n = cont.findOne('#' + id);
      if (n) pos.set(id, { x: n.x(), y: n.y() });
    }
    e.actualizarCapas([...pos.keys()], (l) => pos.get(l.id) ?? {});
  };

  const onTransformEnd = () => {
    const tr = trRef.current;
    if (!tr) return;
    const cambios = new Map<string, Partial<Layer>>();
    for (const n of tr.nodes()) cambios.set(n.id(), { x: n.x(), y: n.y(), rotation: n.rotation(), scaleX: n.scaleX(), scaleY: n.scaleY() });
    e.actualizarCapas([...cambios.keys()], (l) => cambios.get(l.id) ?? {});
  };

  // ------------------------------------------------------------ edición de texto en el lienzo
  const onDblClick = (ev: Konva.KonvaEventObject<MouseEvent>) => {
    const id = capaDeEvento(ev.target);
    const l = doc.layers.find((c) => c.id === id);
    if (l?.type === 'text' && !l.locked) setEditando(l.id);
  };

  const capaEditando = doc.layers.find((l) => l.id === editando) as TextLayer | undefined;
  const nodoEditando = editando ? contenidoRef.current?.findOne('#' + editando) : null;
  const rectEdicion = nodoEditando?.getClientRect();

  const onMedida = useCallback((id: string, w: number, h: number) => {
    const d = useEditor.getState().doc;
    const l = d.layers.find((c) => c.id === id);
    if (!l || (Math.abs(l.width - w) < 0.5 && Math.abs(l.height - h) < 0.5)) return;
    useEditor.getState().fijarSinHistorial((dd) => ({ ...dd, layers: dd.layers.map((c) => (c.id === id ? { ...c, width: w, height: h } : c)) }));
  }, []);

  // ------------------------------------------------------------ cuadrícula
  const lineasCuadricula: JSX.Element[] = [];
  if (e.verCuadricula) {
    const g = e.tamCuadricula;
    const paso = g * zoom < 6 ? g * Math.ceil(6 / (g * zoom)) : g;
    for (let x = paso; x < doc.width; x += paso) lineasCuadricula.push(<Line key={'gx' + x} points={[x, 0, x, doc.height]} stroke="rgba(255,255,255,0.12)" strokeWidth={1 / zoom} />);
    for (let y = paso; y < doc.height; y += paso) lineasCuadricula.push(<Line key={'gy' + y} points={[0, y, doc.width, y]} stroke="rgba(255,255,255,0.12)" strokeWidth={1 / zoom} />);
  }

  const moverGuia = (eje: 'x' | 'y', i: number, valor: number | null) => {
    e.cambiar((d) => {
      const lista = [...d.guides[eje]];
      if (valor === null || valor < 0 || valor > (eje === 'x' ? d.width : d.height)) lista.splice(i, 1);
      else lista[i] = valor;
      return { ...d, guides: { ...d.guides, [eje]: lista } };
    });
  };

  const cursorCss =
    herramientaEfectiva === 'hand' ? (paneo.current ? 'grabbing' : 'grab') : herramientaEfectiva === 'text' ? 'text' : ['shape', 'eyedropper', 'segment'].includes(herramientaEfectiva) ? 'crosshair' : ['mask-hide', 'mask-show', 'ai-erase'].includes(herramientaEfectiva) ? 'none' : 'default';
  const esPincel = ['mask-hide', 'mask-show', 'ai-erase'].includes(herramientaEfectiva) || (herramientaEfectiva === 'segment' && seg.modo === 'pincel');
  const origenSeg = seg.origenId ? (doc.layers.find((l) => l.id === seg.origenId) as ImageLayer | undefined) : undefined;
  const [natSeg, setNatSeg] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!origenSeg) return setNatSeg(null);
    cargarImagen(origenSeg.src).then((im) => setNatSeg({ w: im.width, h: im.height })).catch(() => setNatSeg(null));
  }, [origenSeg?.src]);
  const previaCapa = seg.previa && origenSeg && natSeg ? capaDesdeRecorte(origenSeg, natSeg.w, natSeg.h, seg.previa) : null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#121316]" onContextMenu={(ev) => herramienta === 'segment' && ev.preventDefault()}>
      {e.verReglas && <Reglas ancho={tam.w} alto={tam.h} />}
      <div ref={contRef} className="absolute" style={{ left: e.verReglas ? TAM_REGLA : 0, top: e.verReglas ? TAM_REGLA : 0, right: 0, bottom: 0, cursor: cursorCss }} data-testid="lienzo">
        <Stage
          ref={stageRef}
          width={tam.w}
          height={tam.h}
          scaleX={zoom}
          scaleY={zoom}
          x={pan.x}
          y={pan.y}
          onWheel={onWheel}
          onMouseDown={onDown}
          onTouchStart={onDown}
          onMouseMove={onMove}
          onTouchMove={onMove}
          onMouseUp={onUp}
          onTouchEnd={onUp}
          onMouseLeave={() => setCursor(null)}
          onDblClick={onDblClick}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
        >
          <KLayer>
            <Rect x={0} y={0} width={doc.width} height={doc.height} fill={doc.background} shadowColor="black" shadowBlur={30 / zoom} shadowOpacity={0.5} listening={false} />
            <Group ref={contenidoRef} clipX={0} clipY={0} clipWidth={doc.width} clipHeight={doc.height}>
              {doc.layers.map((l) => (
                <NodoCapa key={l.id} capa={l} onMedida={onMedida} />
              ))}
            </Group>
            {previaCapa && imgPrevia && (
              <KImage image={imgPrevia} {...previaCapa} opacity={0.9} stroke="#4f8cff" strokeWidth={2 / zoom} listening={false} />
            )}
          </KLayer>
          <KLayer listening={herramientaEfectiva === 'select'}>
            {lineasCuadricula}
            {doc.guides.x.map((g, i) => (
              <Line
                key={'vx' + i}
                points={[g, -1e5, g, 1e5]}
                stroke="#22d3ee"
                strokeWidth={1 / zoom}
                hitStrokeWidth={8 / zoom}
                draggable
                dragBoundFunc={(pos) => ({ x: pos.x, y: 0 })}
                onDragEnd={(ev) => moverGuia('x', i, g + ev.target.x())}
                onDragStart={(ev) => (ev.cancelBubble = true)}
              />
            ))}
            {doc.guides.y.map((g, i) => (
              <Line
                key={'hy' + i}
                points={[-1e5, g, 1e5, g]}
                stroke="#22d3ee"
                strokeWidth={1 / zoom}
                hitStrokeWidth={8 / zoom}
                draggable
                dragBoundFunc={(pos) => ({ x: 0, y: pos.y })}
                onDragEnd={(ev) => moverGuia('y', i, g + ev.target.y())}
                onDragStart={(ev) => (ev.cancelBubble = true)}
              />
            ))}
            {guiasInteligentes.v.map((x) => (
              <Line key={'sv' + x} points={[x, -1e4, x, 1e4]} stroke="#f43f5e" strokeWidth={1 / zoom} dash={[4 / zoom, 4 / zoom]} listening={false} />
            ))}
            {guiasInteligentes.h.map((y) => (
              <Line key={'sh' + y} points={[-1e4, y, 1e4, y]} stroke="#f43f5e" strokeWidth={1 / zoom} dash={[4 / zoom, 4 / zoom]} listening={false} />
            ))}
            {banda && (
              <Rect x={Math.min(banda.x0, banda.x1)} y={Math.min(banda.y0, banda.y1)} width={Math.abs(banda.x1 - banda.x0)} height={Math.abs(banda.y1 - banda.y0)} fill="rgba(79,140,255,0.1)" stroke="#4f8cff" strokeWidth={1 / zoom} listening={false} />
            )}
            {formaPrevia && (
              <Rect x={Math.min(formaPrevia.x0, formaPrevia.x1)} y={Math.min(formaPrevia.y0, formaPrevia.y1)} width={Math.abs(formaPrevia.x1 - formaPrevia.x0)} height={Math.abs(formaPrevia.y1 - formaPrevia.y0)} stroke="#4f8cff" dash={[6 / zoom, 4 / zoom]} strokeWidth={1.5 / zoom} listening={false} />
            )}
            {trazo && trazo.modo !== 'mask-hide' && trazo.modo !== 'mask-show' && (
              <Line points={trazo.puntos} stroke={trazo.modo === 'ai-erase' ? 'rgba(239,68,68,0.5)' : 'rgba(79,140,255,0.5)'} strokeWidth={e.pincel.tam} lineCap="round" lineJoin="round" listening={false} />
            )}
            {herramientaEfectiva === 'segment' &&
              origenSeg &&
              natSeg &&
              seg.puntos.map((pt, i) => {
                const q = capaDesdeRecorte(origenSeg, natSeg.w, natSeg.h, { x: pt.x, y: pt.y, width: 0, height: 0 });
                return <Circle key={i} x={q.x} y={q.y} radius={6 / zoom} fill={pt.positivo ? '#22c55e' : '#ef4444'} stroke="#fff" strokeWidth={2 / zoom} listening={false} />;
              })}
            {esPincel && cursor && <Circle x={cursor.x} y={cursor.y} radius={e.pincel.tam / 2} stroke="#fff" strokeWidth={1 / zoom} shadowColor="#000" shadowBlur={2} listening={false} />}
            <Rect x={0} y={0} width={doc.width} height={doc.height} stroke="rgba(255,255,255,0.15)" strokeWidth={1 / zoom} listening={false} />
          </KLayer>
          <KLayer>
            <Transformer
              ref={trRef}
              rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
              rotationSnapTolerance={4}
              anchorSize={9}
              anchorCornerRadius={2}
              borderStroke="#4f8cff"
              anchorStroke="#4f8cff"
              anchorFill="#fff"
              shouldOverdrawWholeArea={seleccion.length > 1}
              onTransformEnd={onTransformEnd}
              onDragEnd={onDragEnd}
              boundBoxFunc={(viejo, nuevo) => (Math.abs(nuevo.width) < 4 || Math.abs(nuevo.height) < 4 ? viejo : nuevo)}
            />
          </KLayer>
        </Stage>
        {capaEditando && rectEdicion && (
          <textarea
            autoFocus
            data-testid="editor-texto"
            className="absolute z-20 resize-none border border-acento bg-black/60 p-1 text-white outline-none"
            style={{
              left: rectEdicion.x,
              top: rectEdicion.y,
              minWidth: Math.max(120, rectEdicion.width),
              minHeight: Math.max(40, rectEdicion.height),
              fontFamily: `"${capaEditando.fontFamily}"`,
              fontWeight: capaEditando.fontWeight,
              fontSize: Math.max(12, Math.min(96, capaEditando.fontSize * zoom * Math.abs(capaEditando.scaleY))),
              lineHeight: capaEditando.lineHeight,
            }}
            defaultValue={capaEditando.text}
            onKeyDown={(ev) => {
              ev.stopPropagation();
              if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) (ev.target as HTMLTextAreaElement).blur();
            }}
            onBlur={(ev) => {
              const v = ev.target.value;
              if (v.trim() && v !== capaEditando.text) e.actualizarCapa(capaEditando.id, { text: v, name: `Texto: ${v.slice(0, 24)}` } as Partial<TextLayer>);
              setEditando(null);
            }}
          />
        )}
        {seg.cargando && <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded bg-black/70 px-3 py-1 text-xs">Segmentando…</div>}
      </div>
    </div>
  );
}
