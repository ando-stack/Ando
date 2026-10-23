# Arquitectura

```
                 ┌────────────── ingesta (Node.js + TypeScript, tsx) ──────────────┐
 Sackmann (HF) ──┤ fuentes/sackmann.ts   histórico 2020→jun 2026, jugadores, rankings │
 api.wtatennis ──┤ fuentes/wta.ts        WTA + WTA 125: calendario, cuadros, OOP,     │
                 │                       resultados con estadísticas, ranking         │
 ESPN ───────────┤ fuentes/espn.ts       ATP: cuadros, OOP, resultados, ranking top150│
 Wikipedia ──────┤ fuentes/wikipedia.ts  Challenger: calendario y cuadros; ATP: sup.  │
                 │ lib/http.ts (caché, límites, reintentos)  lib/registro.ts (ids)   │
                 │ historico.ts (validación) → engine/perfiles.ts + engine/elo.ts    │
                 │ ajuste.ts (medias, priors) · calibrar.ts · backtest.ts            │
                 └──────────────┬───────────────────────────────┬──────────────────┘
                                │ public/data/*.json (snapshot) │ Supabase (service_role)
                                ▼                               ▼
                  Netlify (estático) ◄──── lectura ───── PostgreSQL + RLS (sólo lectura pública)
                                │
                     navegador: React + Vite + Tailwind + Recharts
                     src/lib/datos.ts (Supabase anon → snapshot de respaldo)
                     src/workers/simulacion.worker.ts × N (motor engine/ en paralelo)
```

## Decisiones

- **Node.js (TypeScript) para la ingesta**, no Python: todas las fuentes son JSON/CSV por HTTP, y así la ingesta, la calibración, el backtest y la web comparten exactamente el mismo código del motor y del modelo (`engine/`). Un único entorno (Node 18+) para todo.
- **Snapshot JSON + Supabase.** La ingesta publica `public/data` (lo que se despliega en Netlify) y, si hay credenciales, sincroniza Supabase. La web lee de Supabase cuando está configurado y, si falla, del snapshot, que siempre es la última actualización válida (con su fecha visible).
- **Seguridad:** RLS activo y forzado en las 12 tablas con una única política de lectura (`select` para `anon` y `authenticated`) y `revoke` de escritura; sólo `service_role` (que salta RLS y sólo existe en el entorno de la ingesta) escribe. La clave anónima del navegador es pública por diseño. `.env` está en `.gitignore`; las claves no aparecen en el código. Probado con PostgreSQL 16 emulando los roles de Supabase: lectura anónima permitida; `insert/update/delete` rechazados por permisos y, aunque se concediera el permiso, por RLS (`new row violates row-level security policy`).
- **Simulaciones guardadas** en el navegador (`localStorage`): la regla «escritura sólo desde la ingesta» impide que el navegador escriba en `saved_simulations`. La tabla existe (lectura pública) por si se quiere habilitar más adelante con autenticación.
- **Rendimiento:** el motor no crea objetos dentro del bucle de puntos (registros en `Int32Array`), y la web reparte las simulaciones entre `hardwareConcurrency − 1` workers (máx. 8) con semillas derivadas, de forma que el resultado es reproducible con la misma semilla y número de workers.

## Tablas (supabase/migrations)

`tours`, `tournaments` (categoría, superficie, cubierta, formato, fechas, estado, fuente, avisos), `draws`, `matches` (programados y jugados), `order_of_play`, `players`, `rankings`, `match_stats`, `player_surface_stats` (vector del modelo + porcentajes legibles), `elo_ratings`, `data_updates` (registro de cada fuente en cada ejecución), `saved_simulations`.

## Ficheros del snapshot (public/data)

| Fichero | Contenido |
|---|---|
| `meta.json` | fecha de generación, estado de cada fuente (último intento, último éxito, registros, error), cobertura del histórico |
| `modelo.json` | parámetros del modelo (medias, priors, calibración) |
| `torneos.json`, `torneos/<id>.json` | torneos en curso y próximos; cuadro y orden de juego de cada uno |
| `jugadores.json` | índice para buscar (nombre, país, ranking, Elo, nº de partidos con datos) |
| `jugadores/<0-127>.json` | fichas completas repartidas por hash del id (perfil, últimos partidos, ranking y Elo históricos) |
| `validacion.json` | resumen del backtest |

## Gestión de errores

- Fuente caída o bloqueada → se usa la copia en caché (aunque haya caducado) y se registra el error en `meta.json`/`data_updates`; la web muestra un aviso con la fecha del último dato válido. Si no responde ninguna fuente en vivo, se conservan los torneos anteriores.
- Validación antes de guardar: jugadores existentes y distintos, fechas en rango, duplicados, estadísticas imposibles (`primeros > puntos`, `bp salvados > bp afrontados`, valores negativos o > 400) → se descartan las estadísticas y se conserva el resultado.
- Jugadores sin emparejar con el histórico → se crean con id propio de la fuente y perfil estimado (Elo por ranking si lo tienen).
