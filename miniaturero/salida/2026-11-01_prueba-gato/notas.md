# Prueba de instalación — "¿ME ESTÁ VIGILANDO?"

- **Vídeo supuesto:** "Pongo una cámara a mi gato durante 24 horas".
- **Concepto:** reacción/curiosidad. Gato mirando a cámara a la derecha, texto de pregunta a la izquierda.
- **Texto:** "¿ME ESTÁ VIGILANDO?" (3 palabras; complementa al título, no lo repite).
- **Composición:** sujeto recortado con contorno blanco, sangrando por arriba, abajo y derecha; texto girado −4° arriba a la izquierda; esquina inferior derecha libre de texto.
- **Paleta:** amarillo #ffd60a / naranja #ff7b00 · rojo #e10600 · blanco y negro para el texto.
- **Fuente:** Anton (Google Fonts, SIL OFL 1.1) — copiada en `proyecto/fonts/`.
- **Efectos por código:** degradado radial, rayos (conic-gradient), trama de puntos y viñeta. Sin texturas externas.

## Origen de las imágenes
- `proyecto/img/original_chelsea_CC0.png`: foto "chelsea" del paquete de datos de scikit-image, autor Stéfan van der Walt, **CC0** (sin restricciones).
- `proyecto/img/gato_recorte.png`: recorte con BiRefNet (MIT), volteado en horizontal.

## Revisión
1. Gato demasiado grande: el texto tapaba un ojo → sujeto más pequeño y a la derecha.
2. Línea recta blanca arriba (la foto original corta las orejas) → el sujeto sangra por arriba.
3. OK: legible a 168 px, contraste alto, nada en la zona de la duración.
- **Aviso:** la foto original mide solo 451×300, así que a 3840×2160 el gato se ve blando. Con tus fotos (mínimo 1500 px de alto recomendado) quedará nítido.

## Archivos
- `miniatura.png` — 3840×2160 (subida desde ordenador, límite 50 MB).
- `miniatura.jpg` — misma imagen ≤ 2 MB (subida desde el móvil).
- `comparativa.png` — tamaño grande + tamaño móvil.
- Para re-renderizar: `node herramientas/render.js salida/2026-11-01_prueba-gato/proyecto/miniatura.html salida/2026-11-01_prueba-gato/miniatura.png`
