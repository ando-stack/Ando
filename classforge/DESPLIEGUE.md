# Publicar ClassForge AI en internet (Netlify + Hugging Face)

ClassForge tiene dos partes:

| Parte | Dónde | Por qué |
|---|---|---|
| **Web** (Next.js) | **Netlify** | Son páginas estáticas: Netlify las sirve gratis y rápido. |
| **Servidor** (FastAPI + LibreOffice) | **Hugging Face Spaces** (Docker, gratis) | Netlify no puede ejecutar Python, LibreOffice ni tareas de varios minutos con Claude. |

Al final tendrás una dirección tipo `https://classforge-tuyo.netlify.app` que funciona desde cualquier ordenador, protegida con un **código de acceso** para que nadie más gaste tu saldo de la API de Claude.

Tiempo estimado: 15 minutos. Necesitas cuentas gratuitas en huggingface.co y netlify.com, y una clave de API de Claude (console.anthropic.com).

---

## Paso 1 · El servidor en Hugging Face

1. En huggingface.co › **New › Space**.
   - Nombre: por ejemplo `classforge-api`.
   - SDK: **Docker** › plantilla **Blank**, con hardware **CPU basic (free)**. Docker es gratis con ese hardware.
     Si prefieres **Gradio**, también vale: usa `python classforge/scripts/preparar_space.py --gradio` en el paso 2 (genera `main.py` y `packages.txt` en lugar del `Dockerfile`).
   - Visibilidad: **Public** (necesario para que la web pueda llamarlo; los trabajos siguen protegidos por el código de acceso y por el identificador de cada navegador).
2. Prepara los archivos en tu ordenador, desde la carpeta del repositorio:
   ```bash
   python classforge/scripts/preparar_space.py
   ```
   Se crea `classforge/hf-space/` con `Dockerfile`, `requirements.txt`, `README.md` y la carpeta `app/`.
3. En el Space › **Files › Add file › Upload files**: arrastra **todo el contenido** de `hf-space/` (incluida la carpeta `app`) y pulsa *Commit*.
4. En el Space › **Settings › Variables and secrets**:
   - **New secret** `ANTHROPIC_API_KEY` = tu clave de Claude.
   - **New secret** `CLASSFORGE_ACCESS_PASSWORD` = el código que darás a quien vaya a usarlo (p. ej. `forja-1B-2026`).
   - **New variable** `CLASSFORGE_CORS_ORIGINS` = de momento `http://localhost:3000` (en el paso 3 pondrás la dirección de Netlify).
5. Espera a que el Space diga **Running** (la primera vez tarda unos minutos porque instala LibreOffice).
6. Comprueba que responde abriendo `https://TU-USUARIO-classforge-api.hf.space/api/health`. Debe salir `"ok":true` y `"ai_configured":true`.

Apunta esa dirección (sin `/api/health`): es la **URL del servidor**.

## Paso 2 · La web en Netlify

1. En netlify.com › **Add new site › Import an existing project › GitHub** y elige el repositorio `ando-stack/Ando`.
2. Rama: la que tenga ClassForge (ahora `claude/optimistic-bardeen-tbiqyt`, o `main` si la fusionas).
3. No toques la configuración de build: el archivo `netlify.toml` de la raíz ya indica carpeta, comando y publicación.
4. Antes de desplegar, en **Environment variables** añade:
   - `NEXT_PUBLIC_API_URL` = la URL del servidor del paso 1 (p. ej. `https://tu-usuario-classforge-api.hf.space`).
5. **Deploy**. Al terminar tendrás una dirección `https://algo.netlify.app` (puedes cambiar el nombre en *Site configuration › Change site name*).

> Si cambias `NEXT_PUBLIC_API_URL` más tarde, hay que volver a desplegar (*Deploys › Trigger deploy*), porque se incrusta en la web al compilar.

## Paso 3 · Conectar las dos partes

1. Vuelve al Space › **Settings › Variables** y cambia `CLASSFORGE_CORS_ORIGINS` por tu dirección de Netlify, exacta y sin barra final:
   `https://algo.netlify.app`
   (Si quieres seguir probando en local, separa con comas: `https://algo.netlify.app,http://localhost:3000`.)
2. **Restart** del Space.
3. Abre la web de Netlify en el ordenador de clase: te pedirá el código de acceso una vez y lo recordará en ese navegador.

---

## Cosas que conviene saber

- **El Space gratuito se duerme** tras un tiempo sin uso. La primera visita lo despierta y puede tardar 1-2 minutos: si la web dice «Servidor no disponible», espera y recarga.
- **Los archivos no son permanentes**: se borran a las 24 h y también si el Space se reinicia. Descarga siempre el ZIP.
- **El historial es por navegador**: en el ordenador de clase verás solo los trabajos hechos en ese ordenador.
- **Coste**: cada trabajo hace 3 llamadas a Claude con los documentos. Para limitar el gasto: `CLASSFORGE_JOBS_PER_DAY` y `CLASSFORGE_AI_CALLS_PER_HOUR` (variables del Space), y pon un límite de gasto en console.anthropic.com.
- **Cambiar el código de acceso**: edita el secreto en el Space y reinícialo; a todos se les volverá a pedir.

## Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| «No se puede conectar con el servidor» | `NEXT_PUBLIC_API_URL` mal escrita, o el Space dormido/parado | Abre `…hf.space/api/health`; revisa la variable en Netlify y redespliega |
| Error de CORS en la consola del navegador | `CLASSFORGE_CORS_ORIGINS` no coincide exactamente con la dirección de Netlify | Copia la dirección tal cual (con `https://`, sin `/` final) y reinicia el Space |
| «IA sin configurar» | Falta el secreto `ANTHROPIC_API_KEY` | Añádelo y reinicia el Space |
| Pide el código una y otra vez | Código distinto al del secreto | Revisa `CLASSFORGE_ACCESS_PASSWORD` |
| El Space falla al construir | Faltan archivos | Comprueba que subiste `Dockerfile`, `requirements.txt`, `README.md` y la carpeta `app/` completa |

### Alternativa: Render

El mismo `Dockerfile` vale para Render (render.com › *New Web Service* › repositorio › *Root directory* `classforge/backend` › *Docker*). Pon las mismas variables y añade `PORT=7860`. El plan gratuito de Render tiene solo 512 MB de RAM, justo para LibreOffice; Hugging Face da bastante más.
