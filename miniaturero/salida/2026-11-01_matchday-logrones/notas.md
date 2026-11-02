# Match Day — SD Amorebieta vs UD Logroñés (Copa del Rey)

- **Datos (verificados el 1/11/2026):** primera eliminatoria de Copa del Rey, aplazada del 28/10 por el accidente ferroviario; la RFEF la reprogramó para el **miércoles 4/11 a las 20:00** en el **Campo Municipal de Urritxe** (Amorebieta juega en casa, por eso va primero).
- **Referencia:** póster "Match Day" de un club (solo como inspiración de composición: jugador a la izquierda, "MATCH DAY" grande arriba a la derecha, franjas en diagonal, texto repetido de fondo, competición abajo). No se ha copiado ningún elemento.
- **Colores:** rojo #d6001c, blanco y fondo casi negro #14060a.
- **Fuentes:** Anton y Bebas Neue (titulares), Montserrat (datos). Todas con licencia SIL OFL.
- **Jugador:** Anai Morales (nombre en el póster). **Silueta provisional dibujada con código**. No se usa la foto de ningún jugador real sin permiso. Para ponerlo: deja la foto en `entrada/` → `mini.py recortar` → `proyecto/img/jugador.png` → sustituir el `<svg class="jugador">` por `<img class="jugador" src="img/jugador.png">`.
- **Escudos:** no se han puesto (derechos de los clubes). Se añaden si los aportas y confirmas que puedes usarlos.

## Archivos
- `matchday_4x5.png` (2160×2700, feed de Instagram) y `matchday_9x16.png` (2160×3840, stories; margen abajo para la interfaz).
- `comparativa.png`, `proyecto/matchday.html` (variables en `:root`).
- Re-render: `node herramientas/render.js proyecto/matchday.html matchday_4x5.png 1080 1350 2` (y `1080 1920 2` para 9:16).
