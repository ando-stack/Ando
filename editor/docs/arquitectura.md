# Arquitectura

```
┌──────────────────────── navegador (127.0.0.1) ────────────────────────┐
│  Editor React + TypeScript + Tailwind                                  │
│  ├─ Lienzo Konva (react-konva): zoom, reglas, guías, cuadrícula,       │
│  │   transformador, pinceles (máscara, borrar con IA, segmentar)       │
│  ├─ Estado (zustand) con historial de instantáneas → deshacer ilimitado│
│  ├─ Paneles: herramientas, propiedades, capas, efectos                 │
│  └─ Exportación (PNG/JPG/WebP, ZIP de capas) y vista previa móvil      │
└──────────────┬─────────────────────────────────────────────────────────┘
               │ HTTP JSON + PNG (solo 127.0.0.1)
┌──────────────▼──────────── motor local (FastAPI) ─────────────────────┐
│ server.py   API, cola de trabajos, proyectos, errores controlados      │
│ layers.py   orquesta la descomposición en capas y la compara          │
│ text.py     OCR (RapidOCR/PP-OCRv6) + estilo + fuente parecida         │
│ segment.py  RT-DETRv2 + SAM 2.1 + ViTMatte + BiRefNet (ONNX)           │
│ inpaint.py  Big-LaMa (relleno inteligente) / OpenCV de respaldo        │
│ cloud.py    adaptador OPCIONAL (desactivado) de relleno generativo     │
│ device.py   CUDA → MPS → CPU automático; falta de memoria → reintento  │
│ models/     registro, descarga y verificación de modelos               │
└────────────────────────────────────────────────────────────────────────┘
```

## Por qué Konva (react-konva) y no Fabric.js

- **Integración con React**: react-konva permite describir el lienzo como componentes a partir
  del estado (las capas del proyecto), así el deshacer/rehacer es solo cambiar de instantánea;
  con Fabric.js habría que sincronizar a mano un modelo de objetos mutable con React.
- **Lo que necesitamos ya viene hecho**: `Transformer` (escalar, girar con encaje, varios nodos),
  `TextPath` (texto curvado), degradados, sombras, modos de fusión (`globalCompositeOperation`),
  recorte de grupos, caché y detección de clics por píxel en imágenes con transparencia.
- **Rendimiento**: capas de Konva separadas (contenido / guías / transformador) y redibujado por
  lotes; el contenido pesado (máscaras, ajustes, contorno de recortes) se precompone una vez en
  un lienzo y se reutiliza.
- **Exportación fiel**: se clonan los nodos en un escenario oculto a escala 1 y se exporta a
  tamaño real (también capa a capa), sin depender del zoom de la pantalla.
- Fabric.js tiene mejor edición de texto en el propio lienzo, pero lo resolvemos con un campo de
  texto superpuesto (doble clic) y el panel de propiedades.

## Flujo de la descomposición

1. **Carga y validación**: JPG/PNG/WebP, ≤ 50 MP, se reduce a 2048 px de lado mayor; errores
   claros para archivos dañados, vacíos o demasiado grandes.
2. **Textos** (`text.py`): PP-OCRv6 da líneas con su cuadrilátero; cada línea se endereza y se
   agrupan sus colores (k-means Lab). Se elige el relleno (grupo exclusivo de la caja), se unen los
   grupos de un **degradado**, se detectan **contornos** como anillos concéntricos y su grosor, y la
   **sombra** como copia desplazada. Si la fidelidad es baja se prueba el método «interior del
   contorno». La fuente se identifica comparando con la biblioteca (top-3), y tamaño y espaciado
   se ajustan maximizando la superposición. Se renderiza el resultado y se mide su **fidelidad**.
3. **Borrado de textos** con LaMa → imagen «limpia» (los sujetos que estaban detrás de un texto
   quedan completos).
4. **Sujetos y objetos** (`segment.py`): RT-DETRv2 → SAM 2.1 por caja → relleno de huecos →
   ViTMatte (alfa del pelo). BiRefNet añade lo que el detector no conoce y une piezas pegadas a un
   objeto (plato de una taza…). Las personas mucho más pequeñas que la principal y las clases de
   fondo (mesa, sofá…) se quedan en el fondo. Los objetos de color plano pasan a «gráfico».
   Orden de profundidad por la base de cada sujeto; lo tapado por uno de delante se recorta.
5. **Gráficos planos**: regiones de color uniforme con borde nítido y forma regular (bandas,
   rectángulos, círculos, flechas, insignias).
6. **Fondo**: LaMa rellena lo que ocupaban sujetos y gráficos.
7. **Capas**: fondo, gráficos, sujetos (de atrás a delante), textos editables (o imagen + texto
   oculto si no son fieles) y la **original bloqueada y oculta** arriba, como referencia.
8. **Comprobación**: se compone el resultado y se compara con el original (SSIM, PSNR, % de
   píxeles distintos). El editor muestra la similitud y la confianza de cada capa.

## Formato del proyecto (JSON)

`projects/<id>/proyecto.json` + `projects/<id>/recursos/*.png` (imágenes de capas, máscaras,
fuentes propias y miniatura). Las capas van de abajo a arriba:

```jsonc
{
  "id": "…", "name": "Mi miniatura", "width": 1280, "height": 720, "background": "#000000",
  "formatId": "yt-movil", "palette": ["#…"], "guides": {"x": [640], "y": []},
  "groups": [{"id": "g1", "name": "Grupo 1"}], "customFonts": [{"family": "…", "url": "…"}],
  "decomposition": {"metrics": {"ssim": 0.93, "psnr": 22.2}, "warnings": []},
  "layers": [
    {"id": "…", "type": "image", "role": "fondo", "src": "/api/proyectos/…/recursos/a.png",
     "maskSrc": null, "x": 0, "y": 0, "width": 1280, "height": 720, "rotation": 0,
     "scaleX": 1, "scaleY": 1, "opacity": 1, "blendMode": "source-over", "visible": true,
     "locked": false, "groupId": null, "confidence": 0.78, "warnings": [],
     "adjustments": {"brightness": 0, "contrast": 0, "saturation": 0, "temperature": 0,
                     "sharpen": 0, "blur": 0, "filter": "none"},
     "effects": {"outline": {…}, "glow": {…}, "shadow": {…}}},
    {"id": "…", "type": "text", "role": "texto", "text": "¡NO ME LO CREO!",
     "fontFamily": "Anton", "fontWeight": 400, "fontSize": 130.8, "letterSpacing": 0.9,
     "fill": {"type": "solid", "color": "#ffe600", "gradient": {"colors": […], "angle": 90}},
     "strokes": [{"color": "#000000", "width": 11}], "shadow": {…}, "glow": {…},
     "extrude": {…}, "skewX": 0, "curve": 0,
     "fontCandidates": [{"familia": "Anton", "peso": 400, "puntuacion": 0.91}, …]},
    {"id": "…", "type": "shape", "shapeType": "badge", "fill": {…}, "stroke": {…}, …}
  ]
}
```

Los textos detectados llevan `inkBox` + `needsFit`: al abrir el proyecto, el editor mide la tinta
con la fuente real del navegador y coloca el texto para que coincida píxel a píxel con el original.

## API del motor

| Método y ruta | Uso |
|---|---|
| `GET /api/estado` | dispositivo, modelos disponibles, estado de la nube |
| `GET /api/fuentes` · `GET /api/recursos-libres` | biblioteca de fuentes y efectos |
| `POST /api/descomponer` → `GET /api/trabajos/{id}` | descomposición en segundo plano con progreso |
| `GET/POST/PUT/DELETE /api/proyectos[/{id}]` | proyectos (lista de recientes, guardado automático) |
| `POST /api/proyectos/{id}/recursos` · `/fuentes` · `/miniatura` | subir imágenes, fuentes propias y miniatura |
| `POST /api/ia/quitar-fondo` | recorte de una imagen importada |
| `POST /api/ia/segmentar` | rehacer la segmentación con clics, caja o pincel (y rellenar el hueco) |
| `POST /api/ia/borrar` | borrar objeto con IA (relleno de la zona pintada) |
| `POST /api/ia/dividir` | dividir una capa en sus partes |
| `POST /api/ia/optimizar-png` | reducir colores para respetar un peso máximo |
| `GET /api/nube` · `POST /api/nube/relleno-generativo` | opción en la nube (desactivada; requiere confirmación) |

## Errores y memoria

- Falta de memoria en GPU: SAM/RT-DETR/ViTMatte pasan a CPU; LaMa reduce la resolución
  (1024 → 512) y luego pasa a CPU; BiRefNet pasa a CPU. Todo con aviso.
- Poca RAM: BiRefNet necesita ~8 GB transitorios en CPU; con menos RAM libre se usa SAM + ViTMatte.
- Cualquier excepción del servidor se registra y devuelve un mensaje claro (`{"detalle": …}`);
  el editor la muestra como aviso.
- Rutas de recursos validadas (sin `..`), el servidor escucha solo en 127.0.0.1.
