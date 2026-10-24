// Utilidades de fechas en formato local "YYYY-MM-DD" (sin problemas de zona horaria).

export function aISOLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

export function hoyISO(ahora = new Date()): string {
  return aISOLocal(ahora);
}

/** Crea una fecha local a mediodía (evita saltos por cambio de hora). */
export function desdeISO(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

export function sumarDias(iso: string, n: number): string {
  const d = desdeISO(iso);
  d.setDate(d.getDate() + n);
  return aISOLocal(d);
}

/** 0 = domingo … 6 = sábado */
export function diaSemana(iso: string): number {
  return desdeISO(iso).getDay();
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((desdeISO(hasta).getTime() - desdeISO(desde).getTime()) / 86_400_000);
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export const NOMBRES_DIAS = DIAS;
export const NOMBRES_DIAS_CORTOS = DIAS_CORTOS;
export const NOMBRES_MESES = MESES;

export function fechaLarga(iso: string): string {
  const d = desdeISO(iso);
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

export function fechaCorta(iso: string): string {
  const d = desdeISO(iso);
  return `${DIAS_CORTOS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

/** Desglose de una cuenta atrás. */
export function cuentaAtras(objetivo: string | Date, ahora = new Date()) {
  const ms = new Date(objetivo).getTime() - ahora.getTime();
  const total = Math.max(0, ms);
  return {
    pasado: ms <= 0,
    dias: Math.floor(total / 86_400_000),
    horas: Math.floor((total % 86_400_000) / 3_600_000),
    minutos: Math.floor((total % 3_600_000) / 60_000),
    segundos: Math.floor((total % 60_000) / 1000),
  };
}

export function formatearMinutos(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Semana ISO "2026-W42" de una fecha local. */
export function semanaISO(iso: string): string {
  const d = desdeISO(iso);
  const dia = (d.getDay() + 6) % 7; // lunes = 0
  d.setDate(d.getDate() - dia + 3); // jueves de esa semana
  const primerJueves = new Date(d.getFullYear(), 0, 4, 12);
  const semana = 1 + Math.round(((d.getTime() - primerJueves.getTime()) / 86_400_000 - 3 + ((primerJueves.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(semana).padStart(2, "0")}`;
}
