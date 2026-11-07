# Alcaraz vs Ruud — Semifinal París Masters 1000 (sáb 7/11/2026)

- **Hora (7/11):** el usuario indica 17:15 → "SÁB 7 NOV · 17:15 · HORA DE PARÍS" (se quita "no antes de las 17:00").
- **Datos (verificados el 7/11):** semifinal del Paris Masters 1000, sábado 7 de noviembre, **no antes de las 17:00 (hora de París, CET)**. Alcaraz ganó a Fritz y Ruud a Borges en cuartos (Flashscore, ATP Tour). La sede no se nombra (dudas sobre su nombre actual).
- **Concepto:** duelo tipográfico. Póster partido en diagonal: lado de Alcaraz con colores de España (rojo/amarillo) y lado de Ruud con colores de Noruega (azul/rojo/blanco, con una cruz nórdica muy sutil). La pelota de tenis hace de "VS". Pista dibujada en perspectiva al fondo.
- **Jugadores (añadidos el 7/11):** fotos aportadas por el usuario (`entrada/alcaraz.png`, `entrada/ruud.png`). Alcaraz ya venía sin fondo; a Ruud se le quitó con BiRefNet. Ambas son pequeñas (~600 px de alto), así que a 4K se ven algo blandas.
- **Iluminación 3D** (`mini.py` → `iluminar_3d`): el foco principal de cada uno viene del centro del póster (la raya de luz). Alcaraz: contraluz dorado por fuera y blanco por dentro, foco algo más bajo (clave 0.8) para no quemar la camiseta verde. Ruud: contraluz azul por fuera y blanco por dentro.
- **Logos de marcas:** los que llevan las camisetas y las cintas vienen en las fotos aportadas; no se ha añadido ninguno aparte.
- **Sin logotipos:** ni del torneo ni de patrocinadores ni de la ATP. "Paris Masters 1000" va solo como texto.
- **Fuentes:** Anton, Bebas Neue y Montserrat (SIL OFL). Banderas, pelota y pista dibujadas con código.
- **Revisión con fotos:** 1) en 9:16 los jugadores se solapaban y abajo se amontonaban nombres, jugadores y fecha → nombres arriba, VS entre ellos, jugadores abajo; 2) la bandera de Alcaraz rozaba "PARIS" → nombres más abajo; 3) OK.
- **Revisión (versión sin fotos):** 1) la raya de luz cruzaba "1000" y la fecha, no coincidía con el corte en 9:16 y la hora salía dos veces → raya desvanecida arriba/abajo, ángulo por formato, pie con fondo oscuro, una sola hora; 2) raya desplazada del corte → centrada; 3) OK.

## Archivos
- `poster_4x5.png` (2160×2700), `poster_9x16.png` (2160×3840), `comparativa.png`, `proyecto/poster.html`.
- Re-render: `node herramientas/render.js proyecto/poster.html poster_4x5.png 1080 1350 2` (y `1080 1920 2`).
