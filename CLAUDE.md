# Instrucciones para Claude

Este repositorio tiene dos proyectos:
- **AutoClips** (raíz): saca clips de directos y vídeos.
- **`shorts-factory/`**: fábrica de YouTube Shorts en **inglés** con Remotion para el canal de historias de dinero y negocios.

## Cuando el usuario diga "haz guiones"

Significa: escribir el **siguiente lote de 15 guiones** y **renderizar sus 15 vídeos**.

1. Mira `shorts-factory/lotes/` para saber el último número usado y qué historias ya se han hecho. No repitas ninguna.
2. Crea `shorts-factory/lotes/lote-NNN.json` (NNN = siguiente lote) con 15 Shorts numerados a continuación del último.
   Copia el formato de `lote-001.json`:
   - Todo en **inglés** (voz, textos en pantalla, título, descripción, hashtags).
   - 5–7 escenas por Short, 25–45 s en total. La primera escena es el gancho; la última, una pregunta o una frase final.
   - `big` = cifra o frase corta que se pone grande en pantalla; `tone`: `gold` (neutro), `gain` (verde) o `loss` (rojo).
   - `thumbnail`: `top`, `big`, `bottom`, `emoji`, `tone` opcional.
   - `sources`: de dónde sale cada dato. Usa solo historias reales y contrastadas; si algo es leyenda, el guion lo dice ("as the story goes").
   - Escribe las cifras como se leen en la narración ("seven hundred and fifty thousand dollars") y con números en `big`.
3. Renderiza desde `shorts-factory/`: `npm install` (si falta `node_modules`) y luego
   `NODE_USE_ENV_PROXY=1 node scripts/render.mjs lotes/lote-NNN.json`.
4. Comprueba que cada carpeta `outputs/NNN-slug/` tiene `video.mp4`, `info.txt` y `extras/` (`thumbnail.png`, `script.txt`),
   que ningún vídeo pasa de 60 s, y mira un par de fotogramas.
5. Haz commit y push de `lotes/` y `outputs/` a la rama de trabajo.
6. El usuario quiere los vídeos en su ordenador, no en GitHub: crea en el scratchpad un ZIP
   `MoneyUntold-lote-NNN.zip` con la carpeta `MoneyUntold/shorts/` (solo las carpetas de ese lote)
   y envíaselo con `SendUserFile`. Si hay una carpeta de su ordenador conectada (Remote Control), cópialos allí.
