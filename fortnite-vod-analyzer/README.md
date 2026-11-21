# Fortnite VOD Analyzer — AI Coaching Platform

Plataforma web para coaches de Fortnite competitivo: sube una partida (vídeo o `.replay`), obtén errores con **minuto y segundo exactos**, revísalos en un reproductor con marcadores, añade tus notas y exporta un informe profesional en PDF.

- **Backend**: Python 3.11+ · FastAPI · SQLAlchemy (PostgreSQL/Supabase o SQLite) · FFmpeg · worker en segundo plano.
- **Frontend**: Next.js 15 · TypeScript · Tailwind CSS 4 · Recharts.
- **IA**: modelo multimodal configurable en el servidor (por defecto Anthropic `claude-opus-5-5`, salidas JSON estructuradas, fallback por rechazo activado).
- **Replays**: lector de eventos propio en Python + adaptador opcional FortniteReplayDecompressor (posiciones y zonas).

Documentación: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/REPLAYS.md`](docs/REPLAYS.md)

## Puesta en marcha (desarrollo)

Requisitos: Python 3.11+, Node 20+, FFmpeg en el PATH.

```bash
cd backend && pip install -r requirements-dev.txt && cp .env.example .env
```

Edita `backend/.env` (como mínimo `APP_SECRET` y `ANTHROPIC_API_KEY`; sin `DATABASE_URL` usa SQLite). Después, en dos terminales:

```bash
cd backend && uvicorn app.main:app --port 8000
```

```bash
cd backend && python -m app.worker
```

Frontend:

```bash
cd web && npm install && cp .env.example .env.local && npm run dev
```

Abre http://localhost:3000, crea tu cuenta de coach y un jugador, y pulsa **Nueva partida**.

Con Docker: `docker compose up --build` (Postgres + API + worker + web; el Dockerfile del backend compila también FrdExport).

### Supabase

1. Ejecuta `supabase/schema.sql` en el SQL editor (crea tablas y activa RLS para cerrar la API REST pública).
2. `DATABASE_URL` = cadena de conexión de Postgres de Supabase.
3. Storage: crea un bucket privado `fortnite-vods`, genera claves S3 (Storage → S3 Connection) y usa `STORAGE_BACKEND=s3` con `S3_ENDPOINT=https://<ref>.supabase.co/storage/v1/s3`.
4. Auth: `AUTH_MODE=supabase` + `SUPABASE_URL` en el backend; `NEXT_PUBLIC_AUTH_MODE=supabase`, `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` en el frontend.

### Adaptador de replays FRD (opcional, recomendado)

```bash
cd replay-tools/FrdExport && dotnet publish -c Release -o /opt/frdexport
```

Después pon `FRD_CLI=/opt/frdexport/FrdExport` en `backend/.env`. Sin él, las replays aportan eventos, estadísticas y puesto, pero no nombres, posiciones ni zonas.

## Tests

```bash
cd backend && pytest -q
```

Para incluir replays reales, apunta `FVA_TEST_REPLAYS` a una carpeta con `chapter5season5.replay` (p. ej. `FortniteReplayDecompressor/src/ConsoleReader/Replays`). Para probar con PostgreSQL, define `DATABASE_URL`. Los tests ejecutan la API, FFmpeg, el worker, los parsers y la puntuación reales; solo sustituyen el modelo de IA por un proveedor determinista que cita los fotogramas recibidos (y uno inventado, para comprobar que se descarta).

## Qué está implementado

| Requisito | Estado |
|---|---|
| Subida MP4/MOV/MKV/WEBM con drag & drop, progreso, velocidad, reanudación, info del archivo | ✅ |
| Validación (extensión, tamaño, duración, ffprobe), deduplicación SHA‑256, borrado de vídeos | ✅ |
| Procesado FFmpeg por segmentos con muestreo inteligente (actividad + audio), proxy reproducible | ✅ |
| Análisis visual por segmentos + 6 módulos especializados + comunicación (si hay transcripción) | ✅ |
| Errores con minuto/segundo, qué pasó, por qué, qué debió hacer, cómo evitarlo, gravedad, tipo de error | ✅ |
| Evidencias obligatorias: lo que cita fotogramas/eventos inexistentes se descarta | ✅ |
| `.replay`: validación, versión, descifrado de eventos, eliminaciones/knocks, stats, puesto; posiciones y zonas con FRD | ✅ |
| Replay incompatible: mensaje, sin estadísticas inventadas, flujo de conversión a vídeo | ✅ |
| VOD Review: play/pausa, ±10 s, velocidades 0.25–2x, línea temporal, marcadores, filtros, salto al segundo, notas y marcadores del coach, confirmar/descartar | ✅ |
| Informe de 12 secciones, puntuaciones 0–100 con metodología visible, PDF | ✅ |
| Jugadores: perfil, historial, evolución, objetivos, notas, comparación de dos partidas | ✅ |
| Dashboard: totales, errores frecuentes, evolución, últimos análisis, actividad, objetivos, trabajos en curso | ✅ |
| Trabajos en segundo plano con progreso, cancelación, reintentos y re-encolado | ✅ |

## Limitaciones conocidas (honestas)

- **El análisis real necesita una API key** del proveedor multimodal en el servidor. Sin ella, la subida y el procesado funcionan pero el análisis termina con un error explicativo (no se generan resultados de relleno).
- La IA ve **fotogramas muestreados**, no el vídeo continuo: velocidad de edición, precisión exacta de aim o piece control rápido entre muestras no son verificables y se marcan como tales.
- La **comunicación** solo se evalúa con transcripción (`WHISPER_MODEL` + `faster-whisper`); si no, aparece como "sin datos".
- Las replays de la **temporada actual** no se han podido probar (no hay muestras públicas). Si Epic cambia el formato, el lector lo detecta y lo explica; FRD se actualiza recompilando FrdExport.
- No hay conversor `.replay → vídeo` fuera del juego: la conversión se hace grabando el Modo Repetición de Fortnite (guiado en la app).
- Puntuaciones orientativas de esta herramienta; **no son estadísticas oficiales de Epic Games**.
