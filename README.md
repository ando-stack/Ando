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

# ✂️ AutoClips

Programa **gratis** que saca automáticamente los **momentos graciosos y épicos** de un directo
o un vídeo y te los da listos para **TikTok / Reels / Shorts**.

Pegas el enlace (por ejemplo un directo resubido de Twitch), eliges cuántos clips quieres y
qué tipo de momentos buscas, y te los da ordenados del mejor al peor, listos para descargar.
No corta "cada 30 segundos": busca **dónde pasó algo**.

- **Twitch**: directos resubidos (`twitch.tv/videos/…`) y directos en emisión.
- **YouTube** (vídeos y directos guardados), **Kick**, TikTok, X, Facebook… y más de 1000 webs (gracias a `yt-dlp`).
- También puedes **subir un vídeo** desde tu ordenador.
- Formato **vertical 9:16** con fondo desenfocado (por defecto), vertical recortado u horizontal.
- **Subtítulos automáticos** estilo TikTok (opcional).
- Todo en tu ordenador: sin cuentas, sin marcas de agua, sin límites, sin pagar nada.

## Cómo encuentra los momentos

Puntúa cada medio segundo del directo con varias pistas y monta un clip alrededor de cada pico:

| Pista | Qué detecta |
|---|---|
| 💬 **Chat** (Twitch y YouTube) | Cuándo el chat explota y **con qué**: `KEKW`, `LUL`, `OMEGALUL`, `JAJAJA`, `xD`, 😂 = gracioso · `Pog`, `W`, `NOOO`, 🔥 = épico. Es la mejor pista en streams. |
| 📢 **Audio** | Gritos, risas fuertes, subidones de voz respecto a lo que había antes. |
| 🤣 **IA de voz** (gratis) | Escucha los mejores candidatos y sube los que tienen risas ("jajaja") o reacciones ("¡no puede ser!"). |
| ▶️ **"Lo más repetido"** de YouTube | Si el vídeo tiene esa curva, se usa. |
| 🎬 **Cortes de cámara** | En vídeos subidos o directos grabados. |

- **Duración automática** (15–60 s): cada clip empieza unos segundos **antes** del momento (para
  que se entienda) y termina cuando pasa la reacción. Los cortes se ajustan a pausas para no partir frases.
  También puedes fijar una duración (15 s, 30 s, 1 min…).
- **¿Qué momentos buscas?** *Todo*, *Graciosos* (prioriza risas) o *Épicos* (hype, gritos, jugadas).
- Cada clip muestra **por qué se eligió** (p. ej. `😂 El chat se partió de risa · KEKW×43`).
- Con enlaces **no descarga el vídeo entero**: baja solo el audio para analizar (rápido incluso en
  directos de 6 horas) y luego solo los trozos de los clips.

## 📱 Sin instalar nada (móvil o PC): Google Colab

1. Descarga `AutoClips_Colab.ipynb`.
2. Entra en <https://colab.research.google.com> con tu cuenta de Google →
   **Archivo → Subir cuaderno** (en el móvil: menú ☰ → *Subir*) y elige ese archivo.
3. Pulsa **▶** en el paso 1, espera a que salga ✅, pulsa **▶** en el paso 2 y toca **Abrir AutoClips**.

Funciona en los ordenadores de Google, gratis, desde Android, iPhone o PC. Tienes que dejar la pestaña
abierta mientras trabaja. YouTube a veces bloquea las descargas desde Colab; Twitch suele ir bien.
Si cambias el código, vuelve a crear el cuaderno con `python herramientas/generar_colab.py`.

## 🌐 Publicarlo como web gratis (Hugging Face Spaces)

1. En <https://huggingface.co/new-space>: nombre `autoclips`, SDK **Docker** → *Blank*, hardware gratis (*CPU basic*).
2. Pestaña **Files → Add file → Upload files**: arrastra **todos** los archivos y carpetas de este proyecto
   (el `Dockerfile` y este `README.md` incluidos) y pulsa *Commit*.
3. **Settings → Variables and secrets → New secret**: nombre `AUTOCLIPS_CLAVE`, valor la contraseña que quieras.
   Sin ella, cualquiera con el enlace podría usar tu servidor.
4. Espera a que ponga **Running** (la primera vez tarda unos minutos) y abre `https://TU-USUARIO-autoclips.hf.space`.

## Instalación en tu PC (una sola vez)

1. Instala **Python 3.10 o superior**: <https://www.python.org/downloads/>
   (en Windows marca la casilla **"Add Python to PATH"**).
2. Descarga este proyecto (botón verde **Code → Download ZIP**) y descomprímelo.

No hace falta nada más: `ffmpeg` y la IA de voz se instalan solos la primera vez.

## Uso

- **Windows**: doble clic en `iniciar.bat`
- **Mac / Linux**: abre una terminal en la carpeta y ejecuta `./iniciar.sh`

Se abre el navegador en <http://127.0.0.1:5000>:

1. Pega el enlace (ej. `https://www.twitch.tv/videos/123456789`).
2. Elige número de clips, duración (automática recomendada) y tipo de momentos.
3. Pulsa **🎬 Sacar clips**, espera, y descarga los clips uno a uno o todos en ZIP.

**Directo en emisión**: pega el enlace del canal (`twitch.tv/canal`) y elige cuántos minutos grabar.
Graba desde ese momento (escuchando también el chat) y luego saca los clips.

> Para usarlo desde el **móvil** (misma wifi): `iniciar.bat --red` o `./iniciar.sh --red`
> y abre en el móvil `http://IP-DE-TU-PC:5000`.

### ¿Cuánto tarda?

Como referencia, en un directo resubido de varias horas: unos minutos para bajar el audio y leer el chat,
un par de minutos de IA de voz y unos segundos por clip. Un vídeo de 5 minutos, menos de 1 minuto.
Para ir más rápido: desmarca *Detectar risas con IA de voz*.

### Desde la terminal (opcional)

```bash
python clips.py "https://www.twitch.tv/videos/123456789" -n 10 --estilo graciosos
python clips.py "https://www.youtube.com/watch?v=XXXX" -n 5 -d 30
python clips.py "https://www.twitch.tv/canal" --directo 15 -n 3
python clips.py mi_video.mp4 -n 8 --subtitulos
```

Opciones: `-n` número de clips · `-d` segundos o `auto` · `-e todo|graciosos|epicos`
· `-f vertical_fondo|vertical|original` · `--subtitulos` · `--sin-ia` · `--sin-chat`
· `--directo MIN` · `--rapido` · `-o CARPETA`.

## Problemas frecuentes

- **"No se pudo leer el enlace"**: el vídeo debe ser público (los VODs solo para suscriptores no
  funcionan). Las webs cambian a menudo; los lanzadores actualizan `yt-dlp` en cada arranque, que suele
  arreglarlo. Si YouTube sigue fallando, instala [Deno](https://deno.com) (gratis).
- **No aparece "chat" en "Analizado con"**: ese vídeo no tiene chat guardado (o Twitch no lo dio).
  Funciona igual con el audio y la IA de voz, aunque el chat es lo que mejor detecta lo gracioso.
- **IA de voz desactivada**: en la carpeta, ejecuta `.venv\Scripts\pip install -r requirements-ia.txt`
  (Windows) o `.venv/bin/pip install -r requirements-ia.txt` (Mac/Linux). La primera vez necesita
  internet para bajar el modelo (~150 MB).
- Los trabajos se guardan en `trabajos/` y se borran solos a las 24 h.

Respeta los derechos de autor y las normas de cada plataforma al publicar clips de contenido ajeno.
