import { Link } from 'react-router-dom';
import type { LadoPartido, PartidoVivo, TorneoVivo } from '../lib/tiposDatos';
import { hora } from '../lib/formato';
import { Bandera } from './ui';

export function enlaceSimular(p: PartidoVivo, t: TorneoVivo): string | null {
  if (!p.a.id || !p.b.id) return null;
  const q = new URLSearchParams({
    a: p.a.id,
    b: p.b.id,
    sup: t.superficie ?? 'dura',
    cub: t.cubierta === null ? '' : t.cubierta ? '1' : '0',
    formato: p.fase === 'Q' ? t.formatoQualyId : t.formatoId,
    circuito: t.circuito,
    torneo: `${t.nombre} · ${p.ronda}`,
  });
  return `/simulador?${q.toString()}`;
}

function Lado({ l, gana }: { l: LadoPartido; gana: boolean }) {
  return (
    <div className={`flex min-w-0 items-center gap-1 ${gana ? 'font-semibold text-texto' : 'text-texto-2'}`}>
      <Bandera pais={l.pais} />
      {l.id ? (
        <Link to={`/jugador/${l.id}`} className="truncate hover:underline">
          {l.nombre}
        </Link>
      ) : (
        <span className="truncate">{l.nombre}</span>
      )}
      {l.semilla && <span className="text-xs text-texto-3">[{l.semilla}]</span>}
      {l.entrada && <span className="text-xs text-texto-3">({l.entrada})</span>}
    </div>
  );
}

export function TarjetaPartido({ p, t, conHora = false }: { p: PartidoVivo; t: TorneoVivo; conHora?: boolean }) {
  const url = enlaceSimular(p, t);
  return (
    <div className="flex items-center gap-3 rounded-lg border border-borde bg-superficie px-3 py-2">
      <div className="w-16 shrink-0 text-xs text-texto-3">
        <div>{p.fase === 'Q' ? `Previa ${p.ronda}` : p.ronda}</div>
        {conHora && p.hora && (
          <div className="num">
            {p.noAntesDe ? 'No antes ' : ''}
            {hora(p.hora)}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <Lado l={p.a} gana={p.ganador === 'a'} />
        <Lado l={p.b} gana={p.ganador === 'b'} />
      </div>
      <div className="text-right text-xs text-texto-2">
        {p.marcador && <div className="num">{p.marcador}</div>}
        <div className="text-texto-3">{p.estado}</div>
      </div>
      {url ? (
        <Link to={url} className="rounded-lg bg-acento px-2.5 py-1 text-xs font-semibold text-[#1a1a19] hover:brightness-110">
          Simular
        </Link>
      ) : (
        <span className="w-16 text-center text-[11px] text-texto-3">Rival por determinar</span>
      )}
    </div>
  );
}
