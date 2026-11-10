# Squad Victory — edición de textos (10/11/2026)

- **Original:** miniatura del usuario (confirma que es suya) → `entrada/squad_victory_original.png` (720×404). No se ha tocado nada más que la tarjeta del #1.
- **Cambios:**
  - Nombres: "Deyy, Aloe / Phenom & Jayse" → "ism4, PWR Tinka / PWR Zdog & Crusades" (corregido el 10/11).
  - Puntos: "200" → "100".
  - Icono: bola del mundo → círculo partido en diagonal: España arriba a la izquierda y Australia abajo a la derecha, con el mismo brillo que el icono original.
- **Cómo:** la tarjeta es blanca lisa (255) → textos borrados rellenando con blanco; texto nuevo encima en HTML en las posiciones medidas sobre el original.
- **Fuente (versión 1, descartada):** Archivo Black (SIL OFL), la más parecida a la original. Estrechada al 80 % de ancho para igualarla. "ism4 PWR, Tinka PWR" es mucho más largo que "Deyy, Aloe" y no cabe antes del número con ese ancho: se ha estrechado más (66 %) manteniendo la misma altura. "100" con el mismo tamaño y centro que el "200". Grosor y suavizado ajustados para que no se note el retoque.
- **Fuente (versión 2, actual):** al usuario no le gustaron las letras estrechadas y difuminadas. Se compararon 8 fuentes libres contra el original (ancho natural a la misma altura y parecido de forma): **Inter Black** es la más parecida y ocupa casi el mismo ancho sin deformarla. Se usa para nombres y número, en negro, sin estrechar, sin trazo ni difuminado.
  - Línea 1 a la misma altura y posición que el original; interlineado igual (23 px).
  - "PWR Zdog & Crusades" es más largo que "Phenom & Jayse": para que quepa antes del 100 sin deformar, los nombres van un poco más pequeños (unos 18 px frente a ~23).
  - "100": misma altura, línea base y centro que el "200".
- **Resolución:** el original es 720×404; se exporta a 3840×2160 pero la imagen de fondo sigue siendo la misma (algo blanda). Si tienes el archivo original a más resolución, queda más nítida.

## Archivos
- `miniatura.png` (3840×2160), `miniatura.jpg` (≤ 2 MB, para subir desde el móvil), `comparativa.png` (original vs editada, grande y móvil), `proyecto/` (HTML + base sin textos).
