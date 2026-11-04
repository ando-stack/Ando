# Match Day — SD Amorebieta vs UD Logroñés (Copa del Rey)

- **Datos (verificados el 1/11/2026):** primera eliminatoria de Copa del Rey, aplazada del 28/10 por el accidente ferroviario; la RFEF la reprogramó para el **miércoles 4/11 a las 20:00** en el **Campo Municipal de Urritxe** (Amorebieta juega en casa, por eso va primero).
- **Referencia:** póster "Match Day" de un club (solo como inspiración de composición: jugador a la izquierda, "MATCH DAY" grande arriba a la derecha, franjas en diagonal, texto repetido de fondo, competición abajo). No se ha copiado ningún elemento.
- **Colores:** rojo #d6001c, blanco y fondo casi negro #14060a.
- **Fuentes:** Anton y Bebas Neue (titulares), Montserrat (datos). Todas con licencia SIL OFL.
- **Jugador:** Anai Morales (UD Logroñés). Foto aportada por el usuario (`entrada/anai_morales.webp`, gráfico del club), recortada con BiRefNet → `proyecto/img/jugador.png`. Solo se usa el jugador (sin el texto, el estadio ni el escudo del gráfico). El escudo y el patrocinador de la camiseta vienen en la propia foto.
- **Iluminación (3/11):** `mini.py iluminar` sobre el recorte → `proyecto/img/jugador_iluminado.png`: luz principal suave desde arriba a la izquierda, contorno blanco frío a la izquierda (pelo, hombro, brazo) que pasa a contorno rojo a la derecha, más contraste local y la parte de abajo fundida en sombra. En el HTML: contraluz rojo/blanco detrás de la cabeza y sombra proyectada. Revisión: 1) poco visible → más intensa; 2) se cortaba blanco/rojo de golpe sobre el pelo → transición gradual y cálculo con margen; 3) OK.
- **Iluminación 3D (4/11):** a petición ("iluminación profesional de verdad"), la versión 2D se sustituye por reiluminación con relieve: Depth Anything V2 Small → normales → foco principal arriba-izquierda, relleno suave a la derecha, contraluz rojo detrás-derecha y blanco frío detrás-izquierda, brillo especular suave. Revisión: 1) velo rosado en la camiseta → contraluces solo en los bordes; 2) franja recta abajo y blancos grises → quitado el oscurecido duplicado; 3) halo rosa CSS y mancha en el pelo → solo sombra proyectada y brillo limitado; 4) OK.
- **Fecha (4/11):** el usuario indica que el partido se ha suspendido → "MIÉ 4 NOV | 20:00 H" sustituido por "FECHA POR DEFINIR" (se quita también la hora). Se mantienen el campo y la competición.
- **Escudos:** no se han añadido aparte. Se pueden añadir si los aportas y confirmas que puedes usarlos.
- **Revisión:** 1) el nombre del jugador abajo quedaba apagado y competía con "COPA DEL REY" → eliminado (pediste solo al jugador). 2) OK.

## Archivos
- `matchday_4x5.png` (2160×2700, feed de Instagram) y `matchday_9x16.png` (2160×3840, stories; margen abajo para la interfaz).
- `comparativa.png`, `proyecto/matchday.html` (variables en `:root`).
- Re-render: `node herramientas/render.js proyecto/matchday.html matchday_4x5.png 1080 1350 2` (y `1080 1920 2` para 9:16).
