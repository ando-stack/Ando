# ✂️ AutoClips

Programa **gratis** que saca clips automáticamente de un vídeo o de un directo.
Pegas el enlace, eliges cuántos clips quieres y cuánto dura cada uno, y te los da
listos para descargar (uno a uno o todos en un ZIP).

- Funciona con **YouTube, Twitch, Kick, TikTok, X/Twitter, Facebook, Instagram** y más de 1000 webs (gracias a `yt-dlp`).
- También puedes **subir un vídeo** desde tu ordenador.
- **Directos**: graba los minutos que elijas y saca los clips de esa grabación.
- Formatos: **horizontal**, **vertical 9:16** (TikTok/Reels/Shorts) o **vertical con fondo desenfocado**.
- **Subtítulos automáticos** opcionales, estilo TikTok.
- Todo se ejecuta en tu ordenador: sin cuentas, sin marcas de agua, sin límites, sin pagar nada.

## Cómo encuentra los mejores momentos

Puntúa cada medio segundo del vídeo combinando varias señales y elige los tramos con más
puntuación sin que se repitan:

1. **Subidones de volumen**: gritos, risas, reacciones, música que arranca… (comparado con lo que había justo antes).
2. **Cortes de cámara**: zonas con mucha edición/acción.
3. **"Lo más visto" de YouTube**: si el vídeo tiene la curva de momentos más repetidos, se usa (es la señal más fuerte).
4. Evita silencios y **ajusta el inicio y el final a pausas** para no cortar frases a la mitad.
   Además, prioriza que el momento fuerte quede al final del clip (para que el clip "remate").

## Instalación (una sola vez)

1. Instala **Python 3.10 o superior**: <https://www.python.org/downloads/>
   (en Windows marca la casilla **"Add Python to PATH"**).
2. Descarga este proyecto (botón verde **Code → Download ZIP**) y descomprímelo.

No hace falta instalar nada más: `ffmpeg` se descarga solo con las dependencias.

## Uso

- **Windows**: doble clic en `iniciar.bat`
- **Mac / Linux**: abre una terminal en la carpeta y ejecuta `./iniciar.sh`

Se abrirá el navegador en <http://127.0.0.1:5000>. Pega el enlace, elige cuántos clips y su
duración, pulsa **🎬 Sacar clips** y espera. Al terminar puedes verlos y descargarlos.

> Para usarlo desde el **móvil** (misma wifi): `iniciar.bat --red` o `./iniciar.sh --red`
> y abre en el móvil `http://IP-DE-TU-PC:5000`.

### ¿Cuánto tarda?

Depende del vídeo y de tu ordenador. Como referencia, un vídeo de 5 minutos tarda menos de
1 minuto, y uno de 1 hora unos pocos minutos (la mayor parte es la descarga). Si el vídeo es
muy largo, desmarca **"Analizar cortes de cámara"** para ir más rápido.

### Desde la terminal (opcional)

```bash
python clips.py "https://www.youtube.com/watch?v=XXXX" -n 5 -d 30
python clips.py "https://www.twitch.tv/canal" --directo 15 -n 3 -f vertical
python clips.py mi_video.mp4 -n 8 -d 45 -f vertical_fondo --subtitulos
```

Opciones: `-n` número de clips · `-d` segundos por clip · `-f original|vertical|vertical_fondo`
· `--directo MIN` minutos a grabar si es un directo · `--subtitulos` · `--rapido` (sin análisis de cortes)
· `-o CARPETA` dónde guardar.

## Subtítulos automáticos (opcional)

```bash
pip install -r requirements-subtitulos.txt
```

(dentro del entorno: en Windows `.venv\Scripts\pip install -r requirements-subtitulos.txt`,
en Mac/Linux `.venv/bin/pip install -r requirements-subtitulos.txt`).
La primera vez descarga un modelo de voz gratuito (~150 MB). Funciona en español, inglés y
muchos otros idiomas.

## Problemas frecuentes

- **"No se pudo leer el enlace"**: el vídeo debe ser público. Las webs cambian a menudo; los
  lanzadores actualizan `yt-dlp` en cada arranque, que suele arreglarlo. Si YouTube sigue
  fallando, instala [Deno](https://deno.com) (gratis), que `yt-dlp` usa para YouTube.
- **El directo no graba**: comprueba que está en emisión ahora mismo.
- Los trabajos se guardan en la carpeta `trabajos/` y se borran solos a las 24 h.

Respeta los derechos de autor y las normas de cada plataforma al publicar clips de contenido ajeno.
