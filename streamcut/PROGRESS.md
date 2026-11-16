# Progreso de STREAMCUT AI

Leyenda: ✅ implementado y verificado con pruebas · 🟡 implementado, verificado solo con respuestas simuladas de la API (requiere tus credenciales para probarlo en real) · ⏳ pendiente

## Verificación

- **Backend: 54 pruebas en PostgreSQL 16** (`backend/tests`): unitarias, archivos audiovisuales reales generados con FFmpeg, API extremo a extremo con workers Dramatiq reales y un directo RTMP real enviado al servidor local.
- **Navegador (Playwright)**: inicio de sesión, protección de rutas, subida del vídeo desde la página Importar → análisis real → clips en la Biblioteca → editor, monitor de directos, dashboard y resto de pantallas.
- **Build de producción** de Next.js sin errores de tipos.

## Fases

| Fase | Estado | Notas |
|---|---|---|
| 1. Infraestructura | ✅ | FastAPI, PostgreSQL + Alembic, Redis, Dramatiq, almacenamiento local/S3, Next.js 16 + Tailwind 4, navegación de 11 secciones, Docker Compose, scripts de Windows |
| 2. Monitor de directos | ✅ | Selector de plataforma, URL, identificación, estado, reproductor oficial (Twitch `parent`, YouTube), panel AI LIVE DETECTION, capacidades por canal, gestión de canales |
| 3. Motor multimedia | ✅ | Subida reanudable, duplicados por SHA-256, FFprobe, audio, proxies, miniaturas, waveform, colas, cancelación y reintentos |
| 4. Detección IA | ✅ | Audio con línea base local, risas, gritos, silencios; faster-whisper con palabras e idioma; semántica explicable; escenas/movimiento/caras; chat; puntuación 0–100 configurable; deduplicación |
| 5. Clipping automático | ✅ | Contexto previo, espera al desenlace, sin cortar frases, presets 15/30/45/60/auto/personalizado, render MP4 con subtítulos, sincronía A/V verificada |
| 6. Biblioteca | ✅ | Grid, búsqueda (incluido texto hablado), filtros, reproductor, descarga individual y ZIP, favoritos, etiquetas, colecciones, versiones, papelera, exportar metadatos JSON/CSV |
| 7. Editor | ✅ | Timeline con forma de onda, recorte, dividir, unir, subtítulos editables y estilos, reencuadre/split, zooms, fundidos, audio, deshacer/rehacer, operaciones persistidas, nuevas versiones |
| 8. Integraciones en directo | ✅ / 🟡 | ✅ Fuente autorizada RTMP (OBS) con buffer circular, análisis incremental y clips durante la emisión (probado con un stream real). ✅ Chat de Twitch (parser y detector). 🟡 OAuth Twitch/Google, Helix, EventSub, clips oficiales y su descarga, YouTube Data API: código completo, probado con respuestas simuladas |
| 9. Automatizaciones | ✅ | AUTO PILOT global y por canal, inicio automático, límites, monitorización múltiple con cola de recursos |
| 10. Optimización | ✅ | Caché de análisis, proxies, concurrencia, GPU opcional con fallback CPU, retención, seguridad, documentación |

## Criterios de aceptación

| Criterio | Estado |
|---|---|
| Abrir la aplicación | ✅ |
| Añadir un canal real e identificar su plataforma | ✅ (sin claves: identificación por URL; con claves: verificación en la API 🟡) |
| Mostrar un directo real en el reproductor permitido | ✅ iframe oficial; aquí no hay acceso a Twitch/YouTube para comprobarlo visualmente |
| Consultar el estado de conexión | 🟡 necesita `TWITCH_CLIENT_ID/SECRET` o `YOUTUBE_API_KEY`; sin ellas la interfaz indica «Estado desconocido» |
| Mostrar las capacidades disponibles del canal | ✅ |
| Importar vídeo, analizar audio y transcripción | ✅ |
| Detectar momentos destacados reales | ✅ (el momento real del vídeo de prueba obtiene la mejor puntuación) |
| Generar MP4 reproducibles con subtítulos | ✅ |
| Guardar, reproducir, editar y descargar clips | ✅ |
| Recuperarlos tras cerrar y volver a abrir | ✅ (prueba de reinicio) |
| Clipping automático en directo con fuente autorizada | ✅ (RTMP desde OBS/FFmpeg) |

## Limitaciones conocidas (por diseño o externas)

- **Ver un directo no da acceso a su vídeo.** Sin fuente autorizada, un canal queda en VIEW_ONLY o PLATFORM_CLIPS; la interfaz lo indica y no simula análisis.
- **YouTube** no permite crear clips ni obtener los bytes de un directo por API: esas funciones aparecen como «No disponible».
- **Descarga de clips oficiales de Twitch**: solo para el propietario del canal o sus editores (`editor:manage:clips` / `channel:manage:clips`); si no, se guarda la referencia.
- **EventSub por WebSocket** requiere una cuenta de Twitch conectada; sin ella el estado se consulta cada minuto.
- La detección de risas y gritos es heurística (acústica + texto); funciona bien con reacciones claras y puede fallar con música alta o voces superpuestas.
- La vista previa del editor es aproximada (CSS); el resultado exacto es el MP4 exportado, que se genera con un clic.
- Identificación de hablantes: no implementada (la transcripción no separa voces).
- El rate limiting es en memoria por proceso: detrás de varios nodos conviene un proxy con límites.

## Pendiente / siguientes pasos

- ⏳ Probar con credenciales reales de Twitch y YouTube (OAuth, EventSub, clips oficiales).
- ⏳ Modelo de lenguaje opcional para la puntuación semántica (la interfaz `score_segments` está preparada).
- ⏳ Diarización de hablantes (pyannote) opcional.
- ⏳ Publicación directa en redes sociales (el estado «Publicado» existe y se marca a mano).
- ⏳ Gestión de varios usuarios por workspace (hoy: un propietario por workspace, con aislamiento completo).
