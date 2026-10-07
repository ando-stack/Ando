---
title: AutoClips
emoji: ✂️
colorFrom: pink
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
short_description: Saca los momentos graciosos y épicos de directos y vídeos
---

<!-- La cabecera YAML de arriba configura el Space de Hugging Face de AutoClips (ver AUTOCLIPS.md). -->

# 🎬 Editor de vídeo con IA (local)

Editor de vídeo profesional asistido por IA que se ejecuta en tu ordenador:

1. Subes uno o varios vídeos o clips sueltos.
2. Detecta qué clips son partes del mismo vídeo, los **agrupa, ordena y une**.
3. Hace una **edición completa**: quita silencios, muletillas y tomas falsas, añade cortes con zoom,
   zooms suaves, subtítulos palabra a palabra, títulos, emojis, transiciones y música con *ducking*,
   y corrige la iluminación generando un **LUT `.cube`** cuando hace falta.
4. Todo aparece en una **línea de tiempo por capas** con previsualización en directo y se puede editar a mano.
5. **Pixela caras** solo si lo pides.
6. Un **chat con Claude** aplica cambios en lenguaje natural («quita el emoji del segundo 12»).
7. **Exportas** el vídeo final (16:9 1080p/4K o 9:16 vertical) con sus subtítulos `.srt`, el LUT y el `project.json`.

Todo el procesado (vídeo, audio, caras, transcripción) es local. A la API de Claude solo se envía **texto**:
la transcripción, un resumen del proyecto y tus mensajes del chat. Nunca vídeo ni imágenes de caras.
Los archivos originales **nunca se modifican**.

> Este repositorio contiene también **AutoClips**, otra herramienta independiente: ver [AUTOCLIPS.md](AUTOCLIPS.md).

---

## Requisitos

| | Versión | Para qué |
|---|---|---|
| Python | 3.11 o superior | backend (FastAPI), análisis, transcripción, caras, color |
| Node.js | 18 o superior | interfaz (React + Vite) y render con Remotion |
| FFmpeg + ffprobe | cualquier versión reciente (probado con 6.1) | análisis, proxies, LUT, audio |
| Navegador | Chrome, Edge, Firefox o Safari recientes | interfaz y previsualización |

Comprueba todo con `python backend/check_env.py`; si falta algo, el script explica cómo instalarlo en
Windows, macOS y Linux. Resumen:

- **Windows**: `winget install Python.Python.3.12 OpenJS.NodeJS.LTS Gyan.FFmpeg`
- **macOS**: `brew install python@3.12 node ffmpeg`
- **Linux (Debian/Ubuntu)**: `sudo apt install python3 python3-venv nodejs npm ffmpeg` (Node ≥ 18)

La primera vez se descargan automáticamente el modelo de transcripción (faster-whisper `small`, ~500 MB)
y, al exportar por primera vez, el navegador de render de Remotion (Chrome Headless Shell, ~100 MB).

## Instalación y arranque

**Rápido** (instala lo que falte, compila la interfaz y arranca):

```bash
./iniciar_editor.sh          # Linux / macOS
iniciar_editor.bat           # Windows
```

y abre <http://127.0.0.1:8000>.

**Manual**:

```bash
python3 -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
cd frontend && npm install && npx vite build && cd ..
cp .env.example .env            # y pon tu ANTHROPIC_API_KEY (opcional)
cd backend && python main.py    # http://127.0.0.1:8000
```

**Modo desarrollo** (recarga en caliente de la interfaz): en una terminal `cd backend && uvicorn main:app --reload --port 8000`
y en otra `cd frontend && npm run dev` → <http://localhost:5173> (Vite redirige `/api`, `/files` y `/assets` al backend).

### Clave de API (opcional)

Copia `.env.example` a `.env` y rellena `ANTHROPIC_API_KEY`. `.env` está en `.gitignore`; la clave nunca
aparece en el código. Por defecto se usa el modelo `claude-opus-5-5` (cámbialo con `ANTHROPIC_MODEL`).
Las llamadas activan el respaldo de modelo del servidor (`fallbacks: "default"`): si un modelo rechaza
una petición, la API la reintenta con otro.

**Sin clave**, el editor funciona igual en todo lo que no necesita IA: agrupación (sin la valoración de
continuidad del texto por Claude), silencios, muletillas y tomas repetidas (por reglas), subtítulos, punch-in,
audio, color, caras, edición manual y exportación. La interfaz avisa de que el chat y las decisiones
creativas (títulos, emojis, zooms suaves y transiciones) no están disponibles.

## Flujo de uso

1. **Nuevo vídeo** → arrastra uno o varios archivos (`.mp4 .mov .mkv .webm`). Verás una barra de progreso por archivo.
2. **Analizar y agrupar clips**: para cada clip se leen duración, resolución, fps, códecs, rotación, fecha de
   creación, dispositivo y si tiene audio; se crea un proxy ligero (540p), se extraen fotogramas y se transcribe.
   La agrupación combina: fecha/hora de creación, nombres secuenciales (`VID_0001`, `VID_0002`…), mismo
   formato/dispositivo, parecido visual entre el último fotograma de un clip y el primero del siguiente, y
   continuidad del texto (con Claude si hay clave; si no, por reglas).
3. **Pantalla de confirmación**: cada columna es un vídeo. Arrastra clips para cambiar el orden o el grupo,
   o suéltalos en «Suelta aquí para crear otro vídeo». Cada enlace muestra por qué se unieron
   («grabados seguidos, nombres consecutivos…»). Al confirmar se crea un proyecto por grupo.
4. **Editor** → pestaña *Edición auto* → **✨ Editar automáticamente**. Al terminar verás qué se ha hecho y qué
   no se ha podido aplicar (cada paso es independiente: si uno falla, se avisa y se sigue con el resto).
5. Revisa en el **reproductor** y la **línea de tiempo**; edita a mano, usa el **chat**, ajusta **color** y **caras**.
6. Pestaña **Exportar**.

### Estructura de un proyecto

```
projects/{nombre}/
  originales/      enlaces a tus archivos (nunca se modifican)
  proxies/         versiones ligeras para previsualizar
  audio/           audio de análisis (wav) y audio procesado (normalizado y sin ruido)
  corregidos/      versiones con el LUT aplicado (proxy y resolución completa)
  luts/            todas las versiones del LUT (para poder deshacer)
  lut.cube         LUT en uso, reutilizable en otros programas
  cache/           fotogramas, formas de onda, caras y verificación
  masters/         copias H.264 de originales que Remotion no puede leer directamente (rotados, códecs raros)
  exportaciones/   vídeo final + .srt + lut.cube + project.json
  logs/            comando y error de cualquier fallo de FFmpeg o del render
  project.json     TODA la edición
```

`project.json` es la única fuente de verdad: la IA, el chat y la edición manual lo modifican, y la
previsualización y el render se generan a partir de él. Se valida siempre antes de guardar
(`backend/schema.py`); si un cambio lo dejaría inválido, se rechaza y se explica el motivo.

## Ajustes de la edición automática

| Paso | Ajustes | Notas |
|---|---|---|
| Silencios | activar, umbral (dB), duración mínima, margen | Se deja un margen a cada lado para que el corte no suene brusco y nunca se corta dentro de una palabra. |
| Muletillas | activar | «eh, em, mmm» siempre; «bueno, pues, o sea, vale…» solo si van aisladas entre pausas. |
| Tomas repetidas | activar | Si una frase se repite, se queda la última; con clave, Claude revisa además errores y repeticiones. |
| Punch-in | activar, escala | Zoom alterno en los cortes para disimular los saltos, centrado en la cara si está analizada. |
| Zooms suaves (IA) | activar | En frases importantes. |
| Subtítulos | activar, estilo | Palabra a palabra, bloques cortos, palabra actual resaltada. Estilos: TikTok, Karaoke, Clásico, Neón, Minimalista. |
| Títulos y textos (IA) | activar | Títulos, ideas clave y datos animados. |
| Emojis (IA) | activar, máximo por minuto | Solo del set incluido (Twemoji), nunca dos en menos de 4 s. |
| Transiciones (IA) | activar | Solo en cortes donde cambia el tema: fundido, destello, zoom, barrido, glitch. |
| Intensidad creativa | 0–1 | Cuánto añade la IA y fuerza de los zooms. |
| Audio | normalizar (loudnorm −16 LUFS), reducir ruido (afftdn suave), música, volumen, efectos | La música y los efectos salen de `/assets/music` y `/assets/sfx` (solo archivos tuyos). Ducking automático cuando hay voz. |
| Color | activar | Ver la sección siguiente. |

Claude recibe la transcripción con tiempos y los cortes, y devuelve las decisiones en un JSON con esquema
estricto. Se valida (tiempos dentro del vídeo, emojis del set, límites por minuto, transiciones solo en
cortes). Si no es válido se reintenta una vez; si vuelve a fallar se aplican solo los pasos automáticos y se avisa.

Los umbrales globales (agrupación, color, caras…) están en `backend/config.py`.

## Color y LUT

1. Se analizan fotogramas de muestra de todos los clips del vídeo: luminancia media, histograma (contraste
   y recortes), balance de blancos (sobre zonas neutras: grises y blancos de la escena) y saturación.
2. Si algo está fuera de rango (umbrales en `config.py`: `COLOR_LUMA_RANGE`, `COLOR_MIN_CONTRAST`,
   `COLOR_MAX_TEMP_BIAS`…), se genera por código un **LUT 3D de 33×33×33** que aplica, en este orden:
   balance de blancos (al 80 %, sin cambiar la luminancia), exposición con una curva gamma (0→0 y 1→1:
   no quema altas luces ni empasta sombras), compresión suave de altas luces, contraste con curva S de extremos
   fijos y saturación. Si la iluminación ya es buena **no se aplica nada** y se indica.
3. FFmpeg aplica el LUT (`lut3d`, interpolación tetraédrica) para crear las versiones corregidas: proxies para
   la previsualización y, al exportar, versiones a resolución completa.
4. Pestaña **Color**: activar/desactivar, intensidad (mezcla con el original), temperatura, exposición, contraste
   y saturación, *Analizar de nuevo* y **comparación antes/después** con una línea divisoria que se arrastra
   sobre el vídeo.

**Reutilizar el LUT**: `projects/{nombre}/lut.cube` (y la copia de cada exportación) es un `.cube` estándar.
- DaVinci Resolve: copia el archivo a la carpeta de LUTs (*Project Settings → Color Management → Open LUT Folder*), *Update Lists* y aplícalo a los clips.
- Premiere Pro: *Lumetri Color → Basic Correction → Input LUT → Browse*.
- Final Cut Pro: efecto *Custom LUT*.
- FFmpeg: `ffmpeg -i entrada.mp4 -vf lut3d=lut.cube salida.mp4`.

## Pixelado de caras

Nunca se aplica solo. En la pestaña **Caras** pulsa *Detectar caras* (MediaPipe BlazeFace + OpenCV YuNet,
en local): se siguen las caras a lo largo del vídeo y se asigna un identificador a cada persona (también entre
clips, por parecido). Elige en las miniaturas cuáles pixelar (o todas), el modo (pixelado/desenfoque) y la
intensidad; el margen y el tramo de tiempo se ajustan en el panel de propiedades o arrastrando el bloque en la
pista *Pixelado*. El pixelado sigue la cara fotograma a fotograma, con margen y suavizado, y se dibuja igual en
la previsualización y en el render.

*Comprobar en varios fotogramas* verifica en fotogramas reales que la cara detectada queda dentro de la zona
pixelada y que el detector ya no la reconoce; muestra una hoja de verificación y avisa si hay que subir la
intensidad. Los tramos en los que la detección no es fiable (huecos o baja confianza) se rellenan interpolando
para no dejar la cara al descubierto y se **marcan rayados en rojo** en la pista.

## Línea de tiempo y edición manual

Pistas: vídeo (con forma de onda), subtítulos, textos, emojis, efectos/zooms, transiciones, color, pixelado,
música y efectos de sonido. Las marcas rojas de la regla son los cortes realizados. El ojo de cada pista la
activa o desactiva por completo. Clic en un bloque para seleccionarlo y editarlo en **Propiedades**; arrastra
para moverlo; arrastra los bordes para recortarlo (en los clips de vídeo el recorte desplaza todo lo posterior).
Sin selección, Propiedades permite añadir texto, emoji, zoom, transición o efecto en el cabezal y cambiar el
estilo de los subtítulos. En 9:16 aparece un control de encuadre global y, por clip, *Encuadre X*.

### Atajos de teclado

| Tecla | Acción |
|---|---|
| Espacio | reproducir / pausa |
| ← / → | fotograma anterior / siguiente (con Mayús: 1 s) |
| Inicio | ir al principio |
| S | dividir el clip en el cabezal |
| Supr / Retroceso | borrar el elemento seleccionado |
| Ctrl+D | duplicar el elemento seleccionado |
| Ctrl+Z | deshacer (ilimitado) |
| Ctrl+Mayús+Z o Ctrl+Y | rehacer |
| Ctrl+S | guardar ya (también se guarda solo) |
| Esc | quitar la selección |
| Ctrl+rueda (en la timeline) | zoom de la línea de tiempo |

El proyecto se **guarda automáticamente** (el indicador de la barra superior muestra el estado).

## Chat de edición

Panel derecho. En cada mensaje Claude recibe un resumen del estado del proyecto (elementos con sus ids y
tiempos, cortes, estilo de subtítulos, color, caras, audio y la transcripción con tiempos) y dispone de
herramientas para modificarlo: buscar una frase, añadir/editar/mover/eliminar textos, emojis, zooms,
transiciones y efectos, cambiar el estilo de los subtítulos, recortar un tramo, ajustar color e intensidad
del LUT, analizar/pixelar/despixelar caras, música y volumen, y activar/desactivar pistas.

Cada cambio se **valida contra el esquema** antes de aplicarse (si no es válido, se rechaza y Claude lo
explica), se resume en el chat («He eliminado el emoji 🔥 en 00:12») y **se deshace con Ctrl+Z** como
cualquier otro cambio. Si la petición es ambigua, pregunta a qué elemento te refieres en vez de adivinar.
El historial del chat se guarda en `project.json`.

Ejemplos:

- «Quita el emoji del segundo 12»
- «Pon los subtítulos más grandes y en amarillo»
- «Haz la iluminación más cálida» / «Baja la intensidad del LUT a la mitad»
- «Añade un título "Bienvenidos" cuando digo "bienvenidos"»
- «Recorta del 1:20 al 1:25»
- «Pon un zoom suave en el minuto 0:45»
- «Pon una transición de destello en el segundo corte»
- «Pixela la cara de la persona 2» / «Quita el pixelado»
- «Baja la música al 10 %» / «Desactiva los emojis»

## Exportación

Pestaña **Exportar**. Se renderiza con **Remotion** (`@remotion/renderer`) usando la misma composición que
la previsualización (`frontend/src/remotion/`), pero con los **archivos originales** (o sus versiones con LUT
a resolución completa) en lugar de los proxies, a máxima calidad (H.264 CRF 16 + AAC, `.mp4`).

- **Horizontal 16:9 · 1080p** y **4K** (solo si el original tiene resolución 4K).
- **Vertical 9:16 · 1080×1920** con reencuadre automático centrado en la persona que habla (la cara
  principal, con un seguimiento muy suavizado), ajustable a mano con el control *Encuadre* y por clip.

Barra de progreso y botón **Cancelar**. Cada exportación se guarda en `exportaciones/{fecha}-{preset}/` con
el vídeo, los subtítulos `.srt`, el `lut.cube` (si hay corrección) y el `project.json`.

## Pruebas

```bash
cd backend && python -m pytest -q tests     # requiere espeak-ng para generar voz de prueba
python backend/tools/make_test_clips.py carpeta   # clips de prueba: 3 partes de un vídeo + 1 ajeno
```

Las pruebas generan clips con FFmpeg y voz sintética (tres partes de un mismo vídeo con silencios, muletillas,
una toma repetida, mala iluminación y una cara en movimiento, más un clip ajeno) y comprueban: esquema y
validación, ripple, agrupación y orden, limpieza, LUT, que la buena iluminación no se corrige, caras y
verificación del pixelado, que los originales no cambian, y la IA. Como las pruebas no pueden usar la API
real, `backend/tests/fake_claude.py` simula a Claude (variable `EDITOR_FAKE_AI=1`) devolviendo las mismas
estructuras que la API para probar herramientas, validación, reintento y deshacer; no sustituye a Claude.

## Licencias

- **Remotion** tiene una licencia propia (*Remotion License*), no es software libre: es **gratuito** para
  personas físicas, empresas con ánimo de lucro de **hasta 3 empleados**, organizaciones sin ánimo de lucro y
  para evaluarlo; las empresas más grandes necesitan una **Company License** de pago
  (<https://www.remotion.pro/license>). Texto completo: <https://github.com/remotion-dev/remotion/blob/main/LICENSE.md>.
  Este proyecto usa Remotion 4.0.534.
- Fuentes (SIL OFL 1.1), emojis Twemoji (CC-BY 4.0) y modelos de detección de caras (Apache 2.0 / MIT):
  ver [`assets/LICENSES.md`](assets/LICENSES.md).
- faster-whisper (MIT), modelos Whisper (MIT), MediaPipe (Apache 2.0), OpenCV (Apache 2.0), FFmpeg
  (LGPL/GPL según tu compilación), FastAPI (MIT), React (MIT), Vite (MIT), Tailwind CSS (MIT).
- La música y los efectos de sonido los aportas tú: asegúrate de tener derechos para usarlos.

## Limitaciones conocidas

- **Chat y decisiones creativas** necesitan clave de API. Sin conexión a la API, la parte creativa se omite.
- La detección de **muletillas y tomas falsas** depende de la transcripción: Whisper a veces «limpia» las
  muletillas al transcribir y entonces no se detectan. Con modelos más grandes (`WHISPER_MODEL=medium`) mejora a costa de velocidad.
- La **identificación de personas entre clips** usa un parecido de apariencia sencillo (no reconocimiento facial):
  puede separar a una misma persona en dos identificadores si cambia mucho la luz o el ángulo. El detector de corto
  alcance de MediaPipe funciona mejor con caras cercanas; YuNet cubre caras más pequeñas, pero caras muy pequeñas,
  de perfil total o tapadas pueden no detectarse (esos tramos se marcan como poco fiables cuando están dentro de un seguimiento).
- El **balance de blancos** automático es conservador: si la escena no tiene zonas neutras (atardecer, escena muy
  coloreada) no se corrige la temperatura; ajústala a mano.
- El **reencuadre 9:16** sigue a la cara principal (la que más aparece), no detecta quién habla cuando hay varias personas.
- El **ducking** usa los tramos con voz de la transcripción: en un vídeo hablado sin pausas la música queda baja todo el tiempo.
- Las **transiciones** son efectos sobre el corte (fundido a negro, destello, zoom, barrido, glitch), sin solapar clips.
- Los clips de vídeo de la línea de tiempo se recortan y dividen, pero **no se reordenan arrastrando** (el orden se fija
  en la pantalla de agrupación).
- **Previsualización**: si el navegador no reproduce H.264/AAC (p. ej. Chromium de Linux), al importar se crean
  proxies VP9/Opus automáticamente. La exportación no depende del navegador.
- El render es más lento que tiempo real en CPU (~3–8× la duración del vídeo en 1080p según el equipo).
- Una sola tarea larga a la vez por proyecto en la interfaz; editar mientras corre la edición automática se sobrescribe con su resultado.
