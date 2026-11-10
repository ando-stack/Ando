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
- **Fuente (versión 3, actual):** comparando de cerca con el original se vio que sus nombres van **inclinados unos 4°** (medido en la "D" y la "P": 3,4–4,6°) y el número va recto. Nombres: **Archivo 900** (ancho 75 %) inclinada exactamente 4°, con el "&" clásico de Inter Black. Número: **Work Sans 900** recto. Posiciones medidas al píxel: líneas a 124 y 147 px y número en la misma caja que el "200" (306–393 × 126–161). Para que quepa "PWR Zdog & Crusades" sin deformar, los nombres van un 9 % más bajos que los originales.
- **Fondo (10/11):** el verde del fondo pasa al morado/magenta de la clasificación del torneo (`entrada/clasificacion_squads.webp`): morado (111,33,112) a la izquierda, más oscuro abajo y magenta claro hacia la derecha. Script `proyecto/recolorear_fondo.py`: solo cambia verdes y turquesas fuera del personaje (máscara con BiRefNet), conserva luces, sombras y los cuadros pixelados. No se toca nada más: textos, personaje (camiseta y pendientes siguen verdes), "#1", "$800" y bandera iguales. Revisión: 1) quedaba un filo verde alrededor del personaje y los cuadros turquesa → máscara sin margen y rango de tonos ampliado; 2) OK.
- **Cambio de skin (10/11):** no se genera un render nuevo (no hay modelo 3D y no se recrean personajes con derechos); se usa la imagen de la skin que aporta el usuario (`entrada/skin_nueva.webp`). Pasos (`proyecto/cambiar_skin.py`): máscara de la skin verde → relleno con LaMa → la tarjeta del #1 se separa en una capa (`capa_tarjeta.png`) para que vaya por delante, como en el original → skin nueva recortada con BiRefNet e iluminada en 3D (contraluz rosado por la derecha como la luz fuerte del render original, morado por la izquierda) → colocada a la derecha, sangrando por abajo y cubriendo el final de "VICTORY" igual que la gorra de la verde. La pose es la de la imagen aportada.
- **Resolución:** el original es 720×404; se exporta a 3840×2160 pero la imagen de fondo sigue siendo la misma (algo blanda). Si tienes el archivo original a más resolución, queda más nítida.

## Archivos
- `miniatura.png` (3840×2160), `miniatura.jpg` (≤ 2 MB, para subir desde el móvil), `comparativa.png` (original vs editada, grande y móvil), `proyecto/` (HTML + base sin textos).
