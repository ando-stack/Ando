import { useEffect, useRef } from 'react';
import { useEditor } from '../store';

export const TAM_REGLA = 20;

/** Reglas superior e izquierda. Arrastrando desde una regla se crea una guía. */
export function Reglas({ ancho, alto }: { ancho: number; alto: number }) {
  const sup = useRef<HTMLCanvasElement>(null);
  const izq = useRef<HTMLCanvasElement>(null);
  const { zoom, pan, doc } = useEditor();

  useEffect(() => {
    const dibujar = (c: HTMLCanvasElement | null, horizontal: boolean) => {
      if (!c) return;
      const largo = horizontal ? ancho : alto;
      const dpr = window.devicePixelRatio || 1;
      c.width = (horizontal ? largo : TAM_REGLA) * dpr;
      c.height = (horizontal ? TAM_REGLA : largo) * dpr;
      const ctx = c.getContext('2d')!;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#1c1d21';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.strokeStyle = '#555861';
      ctx.fillStyle = '#8b8e96';
      ctx.font = '9px system-ui, sans-serif';
      const pasos = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
      const paso = pasos.find((p) => p * zoom >= 60) ?? 5000;
      const origen = horizontal ? pan.x : pan.y;
      const inicio = Math.floor(-origen / zoom / paso) * paso;
      const fin = (largo - origen) / zoom;
      // zona del documento resaltada
      ctx.fillStyle = '#26282d';
      if (horizontal) ctx.fillRect(origen, 0, (horizontal ? doc.width : doc.height) * zoom, TAM_REGLA);
      else ctx.fillRect(0, origen, TAM_REGLA, doc.height * zoom);
      ctx.fillStyle = '#8b8e96';
      for (let v = inicio; v <= fin; v += paso / 5) {
        const pos = Math.round(origen + v * zoom) + 0.5;
        const mayor = Math.abs(v % paso) < 1e-6;
        ctx.beginPath();
        if (horizontal) {
          ctx.moveTo(pos, mayor ? 4 : 14);
          ctx.lineTo(pos, TAM_REGLA);
        } else {
          ctx.moveTo(mayor ? 4 : 14, pos);
          ctx.lineTo(TAM_REGLA, pos);
        }
        ctx.stroke();
        if (mayor) {
          if (horizontal) ctx.fillText(String(Math.round(v)), pos + 3, 10);
          else {
            ctx.save();
            ctx.translate(10, pos - 3);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(String(Math.round(v)), 0, 0);
            ctx.restore();
          }
        }
      }
    };
    dibujar(sup.current, true);
    dibujar(izq.current, false);
  }, [ancho, alto, zoom, pan.x, pan.y, doc.width, doc.height]);

  const crearGuia = (eje: 'x' | 'y') => (ev: React.MouseEvent) => {
    ev.preventDefault();
    const fin = (e2: MouseEvent) => {
      window.removeEventListener('mouseup', fin);
      const marco = (ev.target as HTMLElement).parentElement!.getBoundingClientRect();
      const s = useEditor.getState();
      const v = eje === 'x' ? (e2.clientX - marco.left - TAM_REGLA - s.pan.x) / s.zoom : (e2.clientY - marco.top - TAM_REGLA - s.pan.y) / s.zoom;
      const limite = eje === 'x' ? s.doc.width : s.doc.height;
      if (v > 0 && v < limite) s.cambiar((d) => ({ ...d, guides: { ...d.guides, [eje]: [...d.guides[eje], Math.round(v)] } }));
    };
    window.addEventListener('mouseup', fin);
  };

  return (
    <>
      <div className="absolute left-0 top-0 z-10 bg-[#1c1d21]" style={{ width: TAM_REGLA, height: TAM_REGLA }} />
      <canvas ref={sup} title="Arrastra hacia el lienzo para crear una guía vertical" onMouseDown={crearGuia('x')} className="absolute top-0 z-10 cursor-col-resize" style={{ left: TAM_REGLA, width: ancho, height: TAM_REGLA }} />
      <canvas ref={izq} title="Arrastra hacia el lienzo para crear una guía horizontal" onMouseDown={crearGuia('y')} className="absolute left-0 z-10 cursor-row-resize" style={{ top: TAM_REGLA, width: TAM_REGLA, height: alto }} />
    </>
  );
}
