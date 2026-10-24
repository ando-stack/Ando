import { useEffect, useState } from "react";
import { cuentaAtras } from "../lib/fechas";

/** Cuenta atrás hasta el examen (se actualiza cada segundo). */
export function CuentaAtras({ fecha, compacta = false }: { fecha: string; compacta?: boolean }) {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setAhora(new Date()), compacta ? 30_000 : 1000);
    return () => window.clearInterval(t);
  }, [compacta]);
  const c = cuentaAtras(fecha, ahora);
  if (c.pasado) return <span className="font-semibold">¡Examen hecho! 🎉</span>;
  if (compacta) {
    return (
      <span className="font-semibold tabular-nums" aria-label={`Faltan ${c.dias} días y ${c.horas} horas`}>
        {c.dias > 0 ? `${c.dias} d ${c.horas} h` : `${c.horas} h ${c.minutos} min`}
      </span>
    );
  }
  const bloques = [
    { v: c.dias, t: "días" },
    { v: c.horas, t: "horas" },
    { v: c.minutos, t: "min" },
    { v: c.segundos, t: "seg" },
  ];
  return (
    <div className="flex gap-2" aria-label={`Faltan ${c.dias} días, ${c.horas} horas y ${c.minutos} minutos`}>
      {bloques.map((b) => (
        <div key={b.t} className="min-w-14 rounded-2xl bg-white/20 px-2 py-1.5 text-center backdrop-blur">
          <div className="text-xl font-extrabold tabular-nums">{String(b.v).padStart(2, "0")}</div>
          <div className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{b.t}</div>
        </div>
      ))}
    </div>
  );
}
