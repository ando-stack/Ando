# Licencias de los recursos incluidos

| Recurso | Carpeta | Origen | Licencia |
|---|---|---|---|
| Montserrat (ExtraBold, SemiBold) | `fonts/` | Google Fonts vía Fontsource | SIL Open Font License 1.1 (`fonts/LICENSE-montserrat.txt`) |
| Anton | `fonts/` | Google Fonts vía Fontsource | SIL OFL 1.1 (`fonts/LICENSE-anton.txt`) |
| Bebas Neue | `fonts/` | Google Fonts vía Fontsource | SIL OFL 1.1 (`fonts/LICENSE-bebas-neue.txt`) |
| Poppins (ExtraBold) | `fonts/` | Google Fonts vía Fontsource | SIL OFL 1.1 (`fonts/LICENSE-poppins.txt`) |
| Inter (Bold) | `fonts/` | Google Fonts vía Fontsource | SIL OFL 1.1 (`fonts/LICENSE-inter.txt`) |
| Emojis (148 SVG a color) | `emojis/` | Twemoji (paquete `@twemoji/svg` 15.0.0, mantenido por jdecked) | Gráficos: CC-BY 4.0 — © Twitter, Inc. y otros colaboradores. https://github.com/jdecked/twemoji |
| Detector de caras BlazeFace (short range) | `models/blaze_face_short_range.tflite` | Google MediaPipe | Apache License 2.0 |
| Detector de caras YuNet | `models/face_detection_yunet_2023mar.onnx` | OpenCV Zoo | MIT |

**Atribución de Twemoji** (requerida por CC-BY 4.0): «Emoji graphics by Twemoji, licensed under CC-BY 4.0».

`music/` y `sfx/` están vacías a propósito: el editor solo usa archivos de música y efectos que aportes tú.
Asegúrate de tener derechos para usarlos.

El set de emojis se puede regenerar con `python backend/tools/build_emojis.py` (requiere `npm install` en `frontend/`).
