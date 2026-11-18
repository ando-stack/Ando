# STREAMCUT AI

Plataforma de clipping automático con IA: monitoriza directos de Twitch y YouTube, detecta momentos destacados (audio, transcripción, semántica, imagen y chat), crea clips, los edita automáticamente para redes sociales (9:16, 16:9, 1:1 con subtítulos por palabra, reencuadre, zoom y audio normalizado) y los guarda en una biblioteca persistente con editor no destructivo.

> **Qué puede hacer con cada canal depende de los permisos reales.** STREAMCUT nunca extrae vídeo del reproductor embebido ni salta DRM o autenticación. Cada canal muestra su modo:
>
> | Modo | Qué funciona |
> |---|---|
> | **VIEW_ONLY** | Reproductor oficial, estado en directo y metadatos (con clave de API), señal del chat público. No se analiza audio/vídeo. |
> | **PLATFORM_CLIPS** | Además, clips **oficiales** de Twitch vía API (cuenta conectada con `clips:edit`) cuando el chat explota. Se guarda su enlace; el MP4 solo si el endpoint oficial de descargas lo permite (propietario/editor). |
> | **FULL_ANALYSIS** | Con una **señal audiovisual tuya o autorizada** (tu OBS por RTMP, SRT o HLS): buffer circular, análisis incremental en tiempo real y clips MP4 propios editados automáticamente. |
>
> Los vídeos que importas (MP4/MOV/MKV/WEBM) siempre tienen análisis completo.

---

## Puesta en marcha

### Opción A — Docker (Windows, macOS o Linux)

1. Instala [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. En la carpeta `streamcut`: copia `.env.example` a `.env` y rellena `STREAMCUT_SECRET_KEY` y `STREAMCUT_ENCRYPTION_KEY` (el archivo explica cómo generarlas).
3. ```bash
   docker compose up -d --build
   ```
4. Abre <http://localhost:3000> y crea la cuenta de administrador.

Con GPU NVIDIA: `docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build` (Whisper en CUDA y codificación `h264_nvenc`).

### Opción B — Windows nativo, sin Docker

1. Instala los requisitos (PowerShell):
   ```powershell
   winget install Python.Python.3.12 OpenJS.NodeJS.LTS Gyan.FFmpeg
   ```
   Cierra y abre la terminal para que `ffmpeg` esté en el PATH.
2. Doble clic en `scripts\windows\instalar.bat`. Crea `.env` en **modo de un solo proceso** (SQLite + cola en memoria: no hace falta PostgreSQL ni Redis), instala dependencias, aplica las migraciones y compila el frontend.
3. Doble clic en **`STREAMCUT.bat`** (en la carpeta `streamcut`). Abre el servidor y la web en dos ventanas (no las cierres) y, cuando está listo, <http://localhost:3000>.
4. Opcional, para que arranque solo al iniciar Windows: `powershell -ExecutionPolicy Bypass -File scripts\windows\arranque-automatico.ps1` (con `-Quitar` se desactiva). Los canales con AUTO PILOT vuelven a vigilarse solos.
5. Para actualizar a una versión nueva sin perder tus claves: descarga el ZIP en Descargas y ejecuta `scripts\windows\actualizar.ps1`.

La primera transcripción descarga el modelo Whisper elegido (`base` ≈ 150 MB). Para usar PostgreSQL y Redis en Windows, pon `STREAMCUT_RUN_MODE=api`, `STREAMCUT_BROKER=redis` y la URL de PostgreSQL en `.env`; `iniciar.ps1` arrancará también el worker y el monitor.

### Opción C — Desarrollo (Linux/macOS)

```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload --port 8000          # API
.venv/bin/dramatiq app.workers.tasks --processes 1 --threads 2  # workers
.venv/bin/python -m app.live.monitor                         # monitor de directos
cd ../frontend && npm ci && npm run dev                      # http://localhost:3000
```

---

## Credenciales de Twitch y YouTube (no incluidas)

STREAMCUT no trae credenciales. Sin ellas el reproductor y el chat de Twitch funcionan, pero no se puede consultar si un canal está en directo.

**Twitch** — <https://dev.twitch.tv/console/apps> → *Register Your Application*
- OAuth Redirect URL: `http://localhost:3000/api/oauth/twitch/callback` (o tu `STREAMCUT_PUBLIC_BASE_URL`)
- Copia *Client ID* y *Client Secret* en `STREAMCUT_TWITCH_CLIENT_ID` / `STREAMCUT_TWITCH_CLIENT_SECRET`.
- En **Configuración → Conectar Twitch** autorizas tu cuenta (`clips:edit`) para clips oficiales y EventSub. «Con descarga de clips» añade `editor:manage:clips` (solo útil en tu canal o donde seas editor).

**YouTube** — <https://console.cloud.google.com/apis/credentials>
- Habilita *YouTube Data API v3* y crea una **clave de API** → `STREAMCUT_YOUTUBE_API_KEY`.
- Opcional: cliente OAuth web (redirect `…/api/oauth/youtube/callback`) → `STREAMCUT_GOOGLE_CLIENT_ID/SECRET`.
- Cuota: la detección de directos usa la lista de subidas (≈2 unidades por consulta) en lugar de `search.list` (100).

## Editor IA

Sección **Editor IA** del menú. Edita clips completos de forma automática y profesional:

- **Encuadre vertical** (o 1:1 / 16:9): webcam arriba y juego abajo si detecta webcam; si no, cara centrada o fondo difuminado.
- **Corta los silencios muertos** (jump cuts) sin partir palabras.
- **Subtítulos en las frases clave** («de vez en cuando»), en mayúsculas y con la palabra activa resaltada; o todo, o ninguno.
- **Pocos emotes** (1-2 por defecto) colocados en las reacciones reales: risas 😂, gritos 😱, victorias 🔥, fallos 💀…
- **Zoom** suave en la reacción más fuerte, **título gancho** al inicio y **audio nivelado**.

Cómo usarlo:
1. En **Clips** (o **Biblioteca**) marca uno o varios clips y pulsa **Enviar al Editor IA**.
2. O, en **Editor IA**, arrastra tus propios clips (MP4, MOV, MKV, WEBM): se suben y se editan enteros.
3. Cada resultado se puede **ver, descargar, publicar** o **retocar a mano** en el editor manual. «Editar de nuevo» crea otra versión con las opciones actuales; las anteriores se conservan.

Los clips oficiales de Twitch sin vídeo hay que descargarlos antes (botón de la nube en su tarjeta; solo propietario o editores del canal). Los emotes son imágenes de Noto Emoji (Google, licencia Apache 2.0, ver `backend/app/media/assets/emoji/NOTICE.md`).

## Publicar clips en YouTube Shorts, TikTok e Instagram Reels

Cada clip editado tiene un botón **Publicar** (icono de avión de papel). Antes hay que crear una app de desarrollador en cada red (gratis) y conectar tu cuenta en **Configuración → Publicación en redes sociales**.

**YouTube Shorts**: en el mismo proyecto de Google Cloud de la clave de YouTube:
1. *APIs y servicios → Pantalla de consentimiento de OAuth*: tipo **Externo**, añade tu email como **usuario de prueba**.
2. *Credenciales → Crear credenciales → ID de cliente de OAuth* → **Aplicación web**, URI de redirección `http://localhost:3000/api/oauth/youtube/callback`.
3. Copia el ID y el secreto en `STREAMCUT_GOOGLE_CLIENT_ID` / `STREAMCUT_GOOGLE_CLIENT_SECRET` y pulsa **Conectar** en YouTube Shorts.
- Un vídeo vertical de hasta 3 minutos se publica como Short (se añade `#Shorts`). **Los proyectos de Google sin verificar suben los vídeos como privados** hasta pasar la auditoría de la API de YouTube; puedes cambiarlos a públicos desde YouTube Studio.

**TikTok**: en <https://developers.tiktok.com> crea una app, añade los productos **Login Kit** y **Content Posting API** (con «Direct Post»), los scopes `user.info.basic`, `video.upload`, `video.publish` y la redirección `http://localhost:3000/api/oauth/tiktok/callback`. Copia *Client key* y *Client secret* en `STREAMCUT_TIKTOK_CLIENT_KEY/_SECRET`.
- **Hasta que TikTok audite tu app, solo puede publicar en privado** (y tu cuenta debe estar en privado). Si TikTok no acepta `http://localhost` como redirección, usa una URL HTTPS pública que apunte a tu STREAMCUT (por ejemplo un túnel) en `STREAMCUT_PUBLIC_BASE_URL`.

**Instagram Reels**: necesitas una cuenta de Instagram **profesional** (Creador o Empresa). En <https://developers.facebook.com> crea una app de tipo *Empresa* y añade el producto **API de Instagram con inicio de sesión de Instagram**. Copia el *ID* y la *clave secreta de la app de Instagram* en `STREAMCUT_INSTAGRAM_APP_ID/_SECRET`.
- Instagram exige redirecciones **HTTPS**, así que en local lo más sencillo es: en el panel de la app → *Generar tokens de acceso* → añade tu cuenta → **Generar token**, y pégalo en Configuración → «O pega un token de Instagram». STREAMCUT lo renueva solo (dura 60 días).

Los clips oficiales de Twitch (de canales ajenos) no se pueden publicar: STREAMCUT solo guarda su enlace, no el vídeo. Publica solo contenido sobre el que tengas derechos.

## Análisis completo de tus directos (fuente autorizada)

En **Canales → (tu canal) → Fuente audiovisual autorizada**:

- **Recibir desde mi OBS (RTMP local)**: STREAMCUT abre un servidor RTMP (puerto 1935+) y te da servidor y clave. En OBS añade una salida adicional (p. ej. con el plugin *Multiple RTMP outputs*) hacia `rtmp://<IP-del-equipo>:1935/live` con esa clave. Tu emisión a Twitch/YouTube no cambia.
- **Leer una URL autorizada**: `rtmp(s)://`, `srt://` o `https://…m3u8` que tengas derecho a usar. Por seguridad se bloquean direcciones privadas salvo `STREAMCUT_ALLOW_PRIVATE_SOURCES=true`.

Pulsa **INICIAR MONITORIZACIÓN** en el monitor (o activa **AUTO PILOT** en Automatizaciones). El monitor graba un buffer circular de segmentos, analiza el audio incrementalmente, espera el contexto posterior, transcribe y puntúa la ventana, descarta duplicados y renderiza el clip. El panel muestra la latencia real momento → clip.

## Uso rápido

1. **Directos**: elige Twitch/YouTube, pega el enlace, **Conectar**. Verás el reproductor oficial, el estado, las capacidades reales y el panel *AI LIVE DETECTION*.
2. **Importar vídeo**: arrastra archivos; la subida es reanudable (si se corta, vuelve a soltar el mismo archivo). Se crean proxy, audio, miniatura y forma de onda, y se analiza automáticamente. Puedes importar un registro de chat en JSON para usarlo como señal.
3. **Clips / Biblioteca**: revisa, aprueba, busca por texto hablado, filtra, etiqueta, crea colecciones, descarga uno o varios (ZIP), papelera recuperable.
4. **Editor**: recorta arrastrando, divide (S), une, cambia formato y encuadre (split webcam/gameplay), edita subtítulos y su estilo, zooms, audio; deshacer/rehacer; **Guardar y exportar** crea una nueva versión renderizada sin tocar el original.

## Pruebas

```bash
cd backend && .venv/bin/python -m pytest            # 54 pruebas: unitarias, media real, API extremo a extremo, directo RTMP
cd frontend && PW_CHROMIUM_PATH=/ruta/a/chromium npx playwright test   # flujo en navegador (con la app arrancada)
```

Las pruebas generan vídeos reales con FFmpeg (voz sintetizada, risa, grito y cambio de escena), verifican que los MP4 exportados se decodifican enteros y que la desincronía audio/vídeo es < 100 ms.

## Documentación

- [`ARCHITECTURE.md`](ARCHITECTURE.md): arquitectura, flujo de datos, esquema, seguridad y decisiones.
- [`PROGRESS.md`](PROGRESS.md): estado por fase, qué está verificado, limitaciones y pendientes.
- [`.env.example`](.env.example): todas las variables de configuración.

## Dependencias externas

FFmpeg/FFprobe (sistema) · PostgreSQL 16 y Redis 7 (opcionales en modo all-in-one) · Python: FastAPI, SQLAlchemy 2.1, Alembic, Pydantic 2, Dramatiq, faster-whisper (CTranslate2), OpenCV, PySceneDetect, NumPy, httpx, websockets, cryptography, argon2, boto3, psutil · Node: Next.js 16, React 19, TanStack Query 5, Zustand 5, Tailwind CSS 4, Recharts 3, lucide-react. Versiones fijadas en `backend/requirements.txt` y `frontend/package.json` (verificadas en noviembre de 2026).
