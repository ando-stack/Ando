# Arquitectura de STREAMCUT AI

## Visión general

```
Navegador ──► Next.js (frontend, :3000) ──/api/*──► FastAPI (API, :8000) ──► PostgreSQL
                    ▲   SSE /api/events                  │      ▲               ▲
                    └────────────────────────────────────┘      │               │
                                                     Redis (cola Dramatiq + pub/sub de eventos)
                                                         │                      │
                         ┌───────────────────────────────┼──────────────────────┤
                         ▼                               ▼                      │
              Workers Dramatiq                   Monitor de directos ───────────┘
   colas: ingest · analysis · render ·     (consulta Helix/YouTube, EventSub, chat,
          live · maintenance                ingesta RTMP/SRT/HLS autorizada, análisis
                         │                  incremental, AUTO PILOT, latidos)
                         ▼
             Almacenamiento (local o S3): originales inmutables + derivados
```

- El navegador solo habla con Next.js; `/api/*` se reenvía al backend (mismo origen → cookie de sesión `httpOnly`, `SameSite=Lax`).
- **Tres procesos backend** independientes y escalables: API, workers y monitor. En Windows sin Docker, `STREAMCUT_RUN_MODE=all-in-one` los ejecuta en un solo proceso (workers en hilos, broker en memoria).
- El trabajo pesado nunca bloquea la API: todo pasa por colas con estado persistido en la base de datos (progreso, intentos, cancelación).

## Estructura

```
streamcut/
├── backend/
│   ├── app/
│   │   ├── core/          config, seguridad (argon2, sesiones firmadas, Fernet), anti-SSRF, logs sin secretos
│   │   ├── db/            modelos SQLAlchemy (26 tablas) y sesión
│   │   ├── storage/       almacenamiento local / S3, temporales controlados
│   │   ├── media/         FFmpeg (probe, proxies, audio, waveform), EditSpec, subtítulos ASS, render
│   │   ├── analysis/      audio, transcripción, semántica, visual, chat, puntuación y candidatos
│   │   ├── integrations/  Twitch (Helix/OAuth), YouTube (Data API/OAuth), análisis de URLs
│   │   ├── live/          ingesta autorizada (buffer circular), análisis incremental, clipper, chat, EventSub, monitor
│   │   ├── services/      orquestación (pipeline), trabajos, canales/capacidades, plantillas, ajustes, retención, bus
│   │   ├── workers/       broker y actores Dramatiq
│   │   └── api/           rutas FastAPI
│   ├── alembic/           migraciones
│   └── tests/             pruebas con vídeos reales generados
├── frontend/src/
│   ├── app/(app)/         páginas: monitor, dashboard, canales, importar, clips, biblioteca, editor, plantillas, automatizaciones, estadísticas, configuración
│   ├── components/        UI, tarjetas de clip, capacidades, editor (timeline, preview)
│   └── lib/               cliente API, SSE, store (Zustand), tipos
├── docker-compose.yml     db, redis, api, worker, monitor, web
└── scripts/windows/       instalación y arranque nativos
```

## Flujos

### Vídeo importado
1. **Subida reanudable** por trozos de 8 MB (`POST /uploads`, `PUT /uploads/{id}?offset=`, `POST …/complete`). SHA-256 → detección de duplicados. Cuota comprobada antes de empezar.
2. **Ingesta** (cola `ingest`): validación por FFprobe (contenedor, pista de vídeo, duración), miniatura, audio WAV 16 kHz mono, forma de onda, proxy 480p. El original no se modifica nunca.
3. **Análisis** (cola `analysis`), con caché de descriptores de audio y transcripción para reanálisis:
   - *Audio*: RMS, centroide, planitud, flujo espectral cada 0,25 s; z-score respecto a una **línea base local** (mediana/MAD en 90 s, solo sobre tramos activos y excluyendo ±3 s del propio evento) → un micro siempre alto no dispara. Detecta reacciones fuertes, gritos, **risas** (periodicidad 3–7,5 Hz de la envolvente) y silencios.
   - *Transcripción*: faster-whisper (CPU int8 / CUDA fp16), VAD, idioma, timestamps por palabra, confianza = exp(avg_logprob), bloques de 10 min.
   - *Semántica*: léxico explicable ES/EN (risas, reacción, susto, jugada, victoria, derrota, fallo, historia, hype) + prosodia del texto + velocidad de habla relativa.
   - *Visual*: muestreo a 2 fps/160 px (movimiento), PySceneDetect (escenas), Haar cascade a 0,5 fps (caras) → región de webcam estable.
   - *Chat*: si se importa un registro; mensajes/s con línea base robusta y proporción de emotes de risa/hype, adelantado 6 s.
4. **Candidatos**: curva combinada ponderada → picos con supresión de no máximos → límites: contexto previo (frase de planteamiento), espera al desenlace (la reacción cae < 40 % del pico durante 1,5 s), **ajuste a inicios/finales de frase** y pausas, presets 15/30/45/60/auto/personalizado sin partir frases.
5. **Puntuación 0–100** con pesos configurables: interés semántico, reacción vocal, impacto visual, contexto, chat, claridad, originalidad, calidad de audio y desenlace. Las modalidades ausentes no penalizan (se excluyen del denominador). Incluye categoría, confianza (acuerdo entre modalidades + calidad de transcripción) y explicación. Es una estimación de interés, **no** una probabilidad de viralidad.
6. **Deduplicación**: solapamiento > 35 % de la duración menor o similitud de texto > 0,7 frente a candidatos aceptados (también frente a clips anteriores en reanálisis y en directo).
7. **Clip**: plantilla (del canal o por defecto) → `EditSpec` automático → render (cola `render`).

### Edición no destructiva
`EditSpec` (JSON validado con Pydantic, espejo en TypeScript) describe segmentos con **tiempos absolutos del original**, formato, composición (`fit_blur`, `crop`, `split` webcam+gameplay, `fit_black`), zooms, subtítulos (cues con palabras), audio y fundidos. Cada cambio en el editor se guarda como `edit_operation` con número de secuencia (control de concurrencia) y el estado actual en `edit_project`. «Guardar» crea una `clip_version` nueva y la renderiza; las anteriores siguen descargables y restaurables.

**Render**: entrada por segmento con seek preciso → concat → composición → `zoompan` con rampas → fundidos → subtítulos ASS (palabra activa resaltada, animación *pop*) → audio (ganancia, `afftdn`, `loudnorm` EBU R128, limitador) → H.264/AAC `+faststart`. Se verifica con FFprobe que existan ambas pistas y que la desincronía sea < 150 ms (se guarda el valor).

### Directo
- **Estado**: Helix `/streams` en lote (100 canales por petición) cada `MONITOR_POLL_SECONDS`, o al recibir EventSub `stream.online/offline` por WebSocket (si hay cuenta conectada). YouTube: lista de subidas + `videos.list` (`liveBroadcastContent`). Cada emisión crea una `stream_session`.
- **Chat**: Twitch por IRC anónimo de solo lectura (método documentado); YouTube por `liveChatMessages.list` respetando `pollingIntervalMillis`. Detector incremental de picos.
- **FULL_ANALYSIS**: FFmpeg (`-c copy`, segmentos MPEG-TS) en modo *listen* (servidor RTMP local con clave aleatoria cifrada) o *pull* (URL validada, `-protocol_whitelist` sin `file`). Buffer circular podado a `LIVE_BUFFER_MINUTES`. Análisis incremental ligero sobre una ventana deslizante de 3 min; al confirmarse un momento (12 s de contexto posterior) se encola `live_make_clip`: extrae la ventana [−35 s, +22 s] del buffer, la transcribe con el modelo rápido, la puntúa con el mismo motor, deduplica frente a la sesión, crea y renderiza el clip. Latencias registradas: detección y MP4 listo (desde la hora real de llegada del segmento).
- **PLATFORM_CLIPS**: en picos de chat, `POST /helix/clips`, sondeo de `GET /clips` hasta que existe; se guarda URL, miniatura y `edit_url`. Descarga solo con el endpoint oficial de descargas y los scopes de propietario/editor.
- **AUTO PILOT**: ajustes globales + sobrescritura por canal; al detectar una emisión de un canal con piloto activo inicia la monitorización sin navegador abierto. Límites de clips por directo, categorías, puntuación mínima, duración, formato, plantilla, subtítulos.
- **Recursos**: `MAX_LIVE_INGESTS` (cola por prioridad de canal), métricas de CPU/RAM/disco/GPU con psutil en los latidos del monitor.

### Tiempo real en la interfaz
Los servicios publican eventos (`job`, `asset`, `clip`, `detection`, `channel`, `live_stats`) en Redis pub/sub (o bus en memoria). `GET /api/events` (SSE) los reenvía; el frontend invalida las consultas de TanStack Query afectadas, así los clips y detecciones aparecen sin recargar.

## Base de datos

26 tablas (migración `0001`): `users`, `workspaces`, `settings`, `channels`, `channel_connections`, `stream_sessions`, `source_assets`, `media_assets`, `ingestion_jobs`, `analysis_jobs`, `transcript_segments`, `detected_events`, `highlight_candidates`, `clips`, `clip_versions`, `edit_projects`, `edit_operations`, `templates`, `collections`, `collection_clips`, `tags`, `clip_tags`, `exports`, `processing_logs`, `audit_events`, `worker_heartbeats`.

- PK UUID, fechas UTC con zona, estados como `CHECK` (fáciles de migrar), índices por workspace/fecha/puntuación/tiempo.
- FKs con `ON DELETE` explícito: borrar un canal conserva sus clips (`SET NULL`); borrar un workspace borra en cascada.
- Borrado seguro: `deleted_at` (papelera recuperable) y purga física por la política de retención, que también elimina los ficheros.
- Integridad de ficheros: SHA-256 de originales y renders; tamaños registrados para cuotas.

## Seguridad

- Contraseñas argon2id; sesiones firmadas (itsdangerous) con versión de sesión para revocación global; cookie `httpOnly`.
- Tokens OAuth y claves de stream **cifrados en reposo** (Fernet); nunca se devuelven por la API. Estado OAuth firmado y ligado al usuario.
- Comprobación de origen en peticiones que modifican estado (CSRF), rate limiting general y de login, cabeceras de seguridad.
- Anti-SSRF: lista cerrada de hosts para canales; resolución DNS y bloqueo de redes privadas/loopback/link-local para fuentes; lista blanca de protocolos FFmpeg; descargas de clips solo a hosts públicos y sin redirecciones.
- Validación de subidas (extensión, tamaño declarado, trozos, FFprobe), cuotas por workspace, rutas de almacenamiento normalizadas (sin traversal).
- Aislamiento por workspace en todas las consultas (probado: otro usuario recibe 404). Auditoría de acciones sensibles.
- Logs con redacción automática de tokens, secretos y claves RTMP. Workers sin privilegios en Docker (usuario 10001).

## Decisiones

- **Dramatiq** (frente a Celery): más simple, funciona en Windows, el estado y reintentos viven en la BD (idempotencia, cancelación, historial).
- **Análisis de audio con NumPy** en lugar de librosa: mismos descriptores sin el coste de Numba/arranque; librosa no es necesaria.
- **Léxico semántico explicable** en vez de un LLM: funciona sin red ni coste y justifica cada clip; la interfaz `score_segments` permite sustituirlo por un modelo.
- **Proxy de Next.js** para `/api`: un solo origen; por su límite de 10 MB por cuerpo, las subidas usan trozos de 8 MB.
