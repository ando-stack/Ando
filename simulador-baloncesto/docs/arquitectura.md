# Arquitectura

```
                 ┌──────────────── Ingesta (Node.js + TypeScript, tsx) ───────────────┐
 pbpstats (NBA) ─┤ ingest/nba.ts        ┐                                             │
 API EuroLiga   ─┤ ingest/euroleague.ts ├─► data/games/<comp>/<temporada>.json        │
 acb.com / live ─┤ ingest/acb.ts        ┘   (box scores normalizados por partido)     │
                 │          │                                                         │
                 │          ▼ ingest/build.ts (+ validate.ts)                         │
                 │   data/snapshot/<comp>.json  ← equipos, jugadores, tasas, cuartos, │
                 │                                quintetos, rotaciones, bajas, liga  │
                 │          │                    ingest/upload-supabase.ts            │
                 └──────────┼──────────────────────────────┬──────────────────────────┘
                            │ copy-snapshots (build)        ▼
                            ▼                        Supabase (PostgreSQL + RLS)
                  public/data/<comp>.json                   │ lectura (clave anónima,
                            │                                │  solo en el servidor)
                            │                     netlify/functions/snapshot.ts (/api/snapshot)
                            ▼                                ▼
   ┌──────────────────────── Navegador (React + Vite + Tailwind + Recharts) ──────────────┐
   │ src/lib/data.ts  → carga el snapshot (Supabase o estático, con respaldo)             │
   │ src/pages/Simulador → selección, quintetos/minutos/bajas (engine/prepare.ts)         │
   │ src/lib/simulator.ts → reparte N simulaciones entre Web Workers (src/workers)        │
   │      cada worker: engine/run.ts → engine/simulate.ts + engine/aggregate.ts           │
   │ combinación de histogramas → src/pages/Resultados (engine/markets.ts)                 │
   │ Historial: IndexedDB (+ /api/simulations → saved_simulations)                         │
   └───────────────────────────────────────────────────────────────────────────────────────┘
```

## Decisiones

- **Ingesta en Node.js (TypeScript)** en lugar de Python: las tres fuentes son JSON o páginas con
  datos JSON incrustados, así que no hace falta ninguna librería específica de Python; además el
  formato normalizado, la construcción del snapshot y el motor comparten tipos y código, y el
  backtest reutiliza exactamente la misma función que la ingesta (`buildCompetitionSnapshot`).
- **Formato único de partido**: todas las competiciones se reducen a líneas de box score por
  jugador con segundos por cuarto. Todo (estadísticas de equipo y jugador, patrones de minutos,
  quintetos, rotaciones, ausencias, medias de la liga) se calcula a partir de ahí, lo que garantiza
  la coherencia y permite reconstruir el estado «antes de cada partido» para el backtest.
- **Motor en TypeScript puro sin dependencias**, ejecutado igual en Node (calibración, backtest,
  tests) y en el navegador (Web Workers). Generador con semilla.
- **Agregación en histogramas**: cada worker devuelve histogramas en vez de los resultados de cada
  simulación, así 100.000 simulaciones caben en memoria y se combinan sumando.
- **Claves**: la interfaz nunca recibe claves. En modo «supabase» pide los datos a una función de
  Netlify que lee Supabase con la clave anónima (solo lectura, RLS). La escritura (ingesta y
  simulaciones guardadas) usa la clave de servicio solo en scripts de servidor y funciones.
- **Respaldo**: si Supabase falla, la interfaz usa el último snapshot estático válido y muestra su
  fecha. Si una fuente falla en la ingesta, se conserva el último archivo válido y se registra el
  error en `data/data_updates.json` (y en la tabla `data_updates`).
- **Ingesta programada**: GitHub Actions (`.github/workflows/simulador-ingesta.yml`) todos los días;
  las funciones programadas de Netlify tienen límites de tiempo demasiado cortos para la ingesta.

## Estructura

| Carpeta | Contenido |
|---|---|
| `config/` | `reglas.ts` (reglas por competición), `temporadas.ts`, `nba-equipos.ts`, `calibracion.json` |
| `ingest/` | Descarga (NBA, EuroLiga, ACB), construcción del snapshot, validación, verificación, subida a Supabase |
| `engine/` | Tipos, generador aleatorio, preparación, simulación, agregación, mercados, calibración, backtest y tests unitarios |
| `src/` | Interfaz: páginas, componentes, worker y librerías (datos, formato, almacenamiento) |
| `netlify/functions/` | `/api/snapshot` y `/api/simulations` |
| `supabase/migrations/` | Esquema con RLS |
| `data/` | Partidos normalizados, snapshots, backtest, verificación y registro de actualizaciones |
| `tests/` | Fixture, test de coherencia con datos reales y prueba de rendimiento |
