# Arquitectura

```
┌──────────── Navegador ────────────┐        ┌──────────────── Backend (Python) ─────────────────┐
│ Next.js 15 · TypeScript · Tailwind│  HTTPS │ FastAPI (app/main.py)                              │
│  Dashboard · Jugadores · Partidas │ ─────▶ │  auth · players · matches · uploads (chunks)       │
│  Subida por chunks reanudable     │  JWT   │  media (Range + tokens firmados) · analyses · PDF  │
│  VOD Review (vídeo + marcadores)  │        │                                                    │
│  Informe · Comparativas           │        │  jobs (tabla Postgres) ──▶ Worker (app/worker.py)  │
└───────────────┬───────────────────┘        │    FOR UPDATE SKIP LOCKED · heartbeat · reintentos │
                │ Supabase Auth (opcional)   │    ├─ video_pipeline: FFmpeg → muestreo → visión   │
                ▼                            │    └─ replay_pipeline: adaptadores de replay       │
        Supabase (Auth · Postgres · Storage) │  Proveedor multimodal (solo servidor, API key)     │
                                             └────────────────────────────────────────────────────┘
```

- Las claves de IA y de almacenamiento solo existen en el backend. El frontend solo conoce la URL pública de la API (y la anon key de Supabase si se usa Supabase Auth).
- Cada fila pertenece a un `owner_id` (el coach) y todas las consultas filtran por él. En Supabase, el `schema.sql` activa RLS sin políticas para cerrar la API REST pública: solo el backend accede a la base.

## Estructura de carpetas

```
fortnite-vod-analyzer/
├── backend/
│   ├── app/
│   │   ├── main.py · config.py · db.py · models.py · storage.py · security.py · jobs.py · worker.py
│   │   ├── api/        auth, players (+objetivos, comparar), matches, uploads, media, analyses, dashboard
│   │   ├── video/      ffmpeg.py (probe, proxy, señales, fotogramas) · sampling.py · transcribe.py
│   │   ├── replay/     base.py · native.py · frd_cli.py · registry.py
│   │   ├── vision/     provider.py (interfaz + Anthropic)
│   │   └── analysis/   schemas · prompts · engine · scoring · video_pipeline · replay_pipeline · persist · pdf
│   └── tests/          e2e con FFmpeg, worker, Postgres/SQLite y replays reales
├── web/src/            app router (login, (app)/…), components (ui, review/, ReportView…), lib (api, auth, types)
├── replay-tools/FrdExport/   CLI C# sobre FortniteReplayReader
├── supabase/schema.sql
└── docs/
```

## Base de datos

| Tabla | Propósito |
|---|---|
| `users` | coaches (local con scrypt, o vinculados a `auth.users` de Supabase por `external_id`) |
| `players` | perfil: nombre, Epic ID, plataforma, región, modo, nivel, notas |
| `player_goals` | objetivos (pendiente/cumplido/descartado), opcionalmente importados de un informe |
| `matches` | partida: fuente (vídeo/replay), estado, jugador objetivo de la replay |
| `media_files` | vídeo/replay/proxy con metadatos técnicos y SHA‑256 (único por coach → sin duplicados) |
| `uploads` | subidas por chunks reanudables |
| `jobs` | cola de trabajos: estado, etapa, progreso, intentos, heartbeat, log |
| `analyses` | resultado versionado: cronología, cobertura, estadísticas, puntuaciones, informe, datos de replay |
| `frames` | fotogramas muestreados (etiqueta `F0001`, segundo exacto, motivo) = evidencias |
| `findings` | errores/marcadores (IA o coach): categoría, tipo, gravedad, fase, tiempo, 4 campos de coaching, evidencias, estado de revisión |
| `coach_notes` | notas con o sin timestamp |
| `activity` | actividad reciente |

## Pipeline de vídeo (sin enviar nunca el vídeo entero a la IA)

1. **Validación**: extensión permitida, tamaño, `ffprobe` (contenedor MP4/MOV/MKV/WEBM, pista de vídeo, duración máx.).
2. **Proxy**: si el códec/contenedor no se reproduce en navegador → H.264/AAC con los mismos tiempos.
3. **Señales locales** (sin IA): diferencia entre fotogramas a 1 fps (actividad visual), RMS de audio cada 0,5 s (disparos/builds), brillo (pantallas de carga).
4. **Segmentación** en bloques de `SEGMENT_SECONDS`; por segmento, fotogramas *baseline* + fotogramas en **picos de actividad** (y 1,5 s antes de picos fuertes); presupuesto global `MAX_FRAMES_TOTAL`.
5. **Extracción** exacta con `ffmpeg -ss` → JPEG.
6. **Audio** (opcional): transcripción con faster-whisper → evidencias `T###`.
7. **Observación por segmento**: el modelo recibe los fotogramas etiquetados (`F0007 @ 03:25.0`) y devuelve JSON estructurado (HUD, situación, altura, cobertura, zona, eventos, observaciones) citando ids.
8. **Cronología** y fases (por jugadores restantes del HUD; si no, tercios de tiempo marcados como estimados).
9. **Módulos** (Positioning, Rotation, Fight, Endgame, Decision Making, Mechanics, Communication): cada uno recibe la cronología completa + sus fotogramas clave y devuelve hallazgos con evidencias.
10. **Validación de evidencias**: cualquier hallazgo cuyo id no exista se descarta (se cuenta en la cobertura). El timestamp de cada error **es el del fotograma/evento citado**, nunca un número escrito por el modelo.
11. **Deduplicación**, **puntuación transparente** (`analysis/scoring.py`) e **informe** (12 secciones) con structured outputs.

## Puntuación

Ver `backend/app/analysis/scoring.py` (se muestra también en la UI y en el PDF):

`score = clamp(100 − Σ(peso_gravedad × (0.5 + 0.5·confianza)) × 10 / max(10, minutos_analizados) + min(10, 3 × aciertos))`

Pesos: leve 4 · media 9 · alta 16 · crítica 25. Categorías sin datos → "sin datos" (no cuentan). Los errores descartados por el coach no penalizan y la nota se recalcula al instante. No es una estadística oficial de Epic Games.

## Seguridad y fiabilidad

- Lista blanca de extensiones + validación de contenido (ffprobe / firma de replay); límites de tamaño y duración.
- Los archivos se guardan con claves generadas por el servidor, permisos 0640, nunca se ejecutan; FFmpeg y FrdExport se invocan con listas de argumentos (sin shell) y timeouts.
- Streaming con tokens firmados de corta duración y limitados a un archivo/análisis.
- SHA‑256 por coach → no se analiza dos veces el mismo archivo; un solo trabajo activo por partida.
- Estados persistidos (`jobs`), heartbeat, re-encolado de trabajos huérfanos, cancelación, limpieza de análisis parciales.
- Borrado de vídeo (conserva análisis), de partida y de jugador (borra todos sus archivos).
