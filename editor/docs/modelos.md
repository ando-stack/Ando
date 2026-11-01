# Modelos de IA: selección, licencias y rendimiento

Fecha de la revisión: 31-10-2026. Todos los modelos elegidos son de código abierto, se ejecutan
en local y **permiten uso comercial**. Ninguno ejecuta código descargado de Internet: los de
Hugging Face usan arquitecturas incluidas en la librería `transformers` o archivos ONNX
(solo pesos), y la revisión (commit) de cada repositorio está fijada en
[`engine/models/registry.py`](../engine/models/registry.py).

## Resumen

| Tarea | Modelo elegido | Licencia | Uso comercial | Tamaño | Tiempo medido (CPU, 4 hilos) |
|---|---|---|---|---|---|
| Recorte de alta calidad del sujeto principal (pelo, bordes) | **BiRefNet** (general) en ONNX — `onnx-community/BiRefNet-ONNX` | MIT | Sí | 973 MB | 20–25 s por imagen (entrada fija 1024²), pico de RAM ≈ 8,4 GB |
| Variante ligera (opcional) | BiRefNet_lite en ONNX — `onnx-community/BiRefNet_lite-ONNX` | MIT | Sí | 224 MB | ≈ 18 s, pico ≈ 7,2 GB |
| Detección de personas y objetos | **RT-DETRv2 R18** — `PekingU/rtdetr_v2_r18vd` | Apache-2.0 | Sí | 81 MB | 0,3 s |
| Segmentación por caja / clics | **SAM 2.1 Hiera-Small** — `facebook/sam2.1-hiera-small` | Apache-2.0 | Sí | 184 MB | 1,3 s (codificar la imagen) + 0,1 s por clic |
| Afinado de bordes (trimapa → alfa) | **ViTMatte-Small Composition-1k** — `hustvl/vitmatte-small-composition-1k` | Apache-2.0 | Sí | 103 MB | 0,6 s por sujeto |
| Detección de texto (cajas giradas) | **PP-OCRv6 det medium** (PaddleOCR) en ONNX vía RapidOCR | Apache-2.0 | Sí | 62 MB | ≈ 5 s detección + lectura |
| Lectura de texto multilingüe (español: á, é, ñ, ¿, ¡) | **PP-OCRv6 rec medium** en ONNX vía RapidOCR | Apache-2.0 | Sí | 77 MB | (incluido arriba) |
| Relleno inteligente (inpainting) | **Big-LaMa** (Samsung Research), TorchScript publicado por IOPaint | Apache-2.0 | Sí | 206 MB | 4–7 s por zona (a ≤ 1024 px) |
| Identificación de la fuente | Algoritmo propio (sin modelo): comparación visual con la biblioteca de 45 fuentes libres | — | — | — | ≈ 0,3 s por texto |


Rendimiento total medido en este equipo (4 hilos de CPU, 15 GB de RAM, **sin GPU**): **31–50 s
por imagen** de 1280×720 a 1080×1350 (ver [`test-images/resultados/informe.md`](../test-images/resultados/informe.md)).
Con una GPU NVIDIA (CUDA) los modelos PyTorch se ejecutan en la GPU automáticamente; los ONNX
también si se instala `onnxruntime-gpu` en lugar de `onnxruntime`.

## Integridad de las descargas

`scripts/instalar.py` descarga cada modelo con la revisión fijada y comprueba su integridad:

- **Hugging Face**: `huggingface_hub` verifica el SHA-256 de cada archivo grande (LFS) contra el
  servidor, y además el registro fija el SHA-256 de los pesos de SAM 2.1 y RT-DETRv2.
- **Big-LaMa** (`github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt`):
  MD5 `e3aa4aaa15225a33ec84f9f4bc47e500` (el mismo que usa IOPaint) y SHA-256
  `344c77bbcb158f17dd143070d1e789f38a66c04202311ae3a258ef66667a9ea9`.
- **PP-OCRv6** (ModelScope, `RapidAI/RapidOCR` v3.10.0): SHA-256 publicados por RapidOCR
  (`92078b73…07c2` det, `eef44482…894b` rec).

Si una suma no coincide, el archivo se borra y la instalación se detiene con un error.

## 1. Segmentación de sujetos y recorte de fondo

**Opciones evaluadas**

| Opción | Resultado |
|---|---|
| BiRefNet (MIT) | Elegido. Muy buen pelo y bordes; en nuestras pruebas recorta limpiamente retratos (ver `test-images/resultados`). La versión *lite* incluye objetos del fondo que la completa descarta. |
| BRIA RMBG-2.0 | **Descartado**: licencia CC BY-NC 4.0 (solo uso no comercial; uso comercial bajo acuerdo con BRIA). [Ficha](https://huggingface.co/briaai/RMBG-2.0) |
| BiRefNet en PyTorch (`ZhengPeng7/BiRefNet`) | Descartado: necesita `trust_remote_code` (ejecuta código Python del repositorio). Usamos el mismo modelo exportado a ONNX. |
| SAM 2.1 (Apache-2.0) | Elegido para segmentar por **caja** (a partir del detector) y por **clics** del usuario. Rápido una vez codificada la imagen. [Ficha](https://huggingface.co/facebook/sam2.1-hiera-small) |
| SAM 3 (Meta) | No elegido: pesos con acceso restringido, licencia propia («SAM License») y 3,4 GB. |
| YOLO (Ultralytics) | No elegido: AGPL-3.0 (obligaría a publicar el código de un servicio comercial). |
| RT-DETRv2 (Apache-2.0) | Elegido como detector de personas/objetos (COCO). [Ficha](https://huggingface.co/PekingU/rtdetr_v2_r18vd) |
| ViTMatte (Apache-2.0) | Elegido para convertir las máscaras de SAM en un alfa suave (pelo). [Ficha](https://huggingface.co/hustvl/vitmatte-small-composition-1k) |

**Cómo se combinan**: RT-DETRv2 encuentra personas y objetos → SAM 2.1 los segmenta con su caja
→ ViTMatte afina el borde → BiRefNet añade lo que el detector no conoce (elementos destacados) y
se usa para «quitar fondo» al importar fotos propias. Si el equipo no tiene ≥ 7,5 GB de RAM libre,
BiRefNet se sustituye automáticamente por SAM + ViTMatte (con aviso).

## 2. OCR (texto, posición, tamaño, color, rotación)

| Opción | Resultado |
|---|---|
| **RapidOCR + PP-OCRv6 medium** (Apache-2.0) | Elegido. ONNX (sin código remoto), cajas giradas, modelo multilingüe con español; en nuestras pruebas lee bien textos con contorno y efectos (13/14 textos exactos). El modelo *small* (incluido en el paquete, sin descarga) omite tildes. [RapidOCR](https://github.com/RapidAI/RapidOCR) · [lista de modelos](https://rapidai.github.io/RapidOCRDocs/main/model_list/) |
| EasyOCR (Apache-2.0) | Alternativa válida (admite español), pero sus pesos se cargan con `pickle` de PyTorch y su detector CRAFT es más lento en CPU. [Repositorio](https://github.com/JaidedAI/EasyOCR) |
| PaddleOCR nativo | Mismo modelo, pero requiere instalar PaddlePaddle (pesado). |

El OCR da el texto y la caja; **el estilo lo calcula nuestro código** (`engine/text.py`):
agrupación de colores (k-means en Lab) dentro de la caja enderezada, color de relleno y
**degradado** vertical, **varios contornos** concéntricos con su grosor (por distancia al relleno),
**sombra** desplazada (correlación), rotación y tamaño de fuente. Si el método por color no
reproduce bien el texto, se prueba un segundo método que toma el relleno como el interior
encerrado por el contorno (útil en miniaturas con contorno blanco sobre fondos parecidos al
relleno). Se mide la **fidelidad** (IoU entre la tinta original y la renderizada); si es < 0,5 el
texto se deja como imagen recortada con aviso y su versión editable queda oculta para recrearlo.

## 3. Relleno inteligente

| Opción | Resultado |
|---|---|
| **Big-LaMa** (Apache-2.0) | Elegido. Buen resultado en fondos planos y texturas; se procesa por zonas a ≤ 1024 px y se mezcla con el original en el borde. [Repositorio](https://github.com/advimman/lama) · [licencia](https://github.com/advimman/lama/blob/main/LICENSE) |
| `Carve/LaMa-ONNX` | Entrada fija de 512 px: peor en imágenes grandes. |
| Modelos de difusión (SD-inpainting) | Demasiado lentos en CPU y con licencias más restrictivas. Disponible como opción **en la nube** (ver más abajo). |

Si LaMa falla o no está, se usa `cv2.inpaint` (Telea) avisando.

## 4. Modelos de descomposición en capas

| Modelo | Licencia | Evaluación |
|---|---|---|
| **Qwen-Image-Layered** (Qwen, dic. 2025) | Apache-2.0 | Descompone en capas RGBA, pero tiene **20 000 millones de parámetros** (BF16) y su ejemplo requiere CUDA con 50 pasos de difusión: inviable en CPU o GPUs modestas, y sus capas son imágenes (no texto editable). [Ficha](https://huggingface.co/Qwen/Qwen-Image-Layered) · [artículo](https://arxiv.org/abs/2512.15603) |
| **LayerD** (CyberAgent, ICCV 2025) | Código Apache-2.0; pesos `cyberagent/layerd-birefnet` Apache-2.0 | Extrae iterativamente la capa superior con un BiRefNet afinado + relleno con LaMa. Funciona en CPU, pero está pensado para diseños gráficos planos, produce solo capas de imagen (los textos no quedan editables), su matting pesa 885 MB y el repositorio se archivó el 30-10-2026. [Repositorio](https://github.com/CyberAgentAILab/LayerD) · [artículo](https://openaccess.thecvf.com/content/ICCV2025/html/Suzuki_LayerD_Decomposing_Raster_Graphic_Designs_into_Layers_ICCV_2025_paper.html) |

**Decisión**: la combinación OCR + estilo de texto + detector + SAM 2.1 + ViTMatte + BiRefNet +
LaMa da **textos editables** (lo que más valor aporta en miniaturas y pósters) y sujetos con
bordes limpios, funciona en CPU y reconstruye el original con un SSIM de 0,87–0,98 en nuestras
pruebas. LayerD usa los mismos bloques (BiRefNet + LaMa) sin la parte de texto; Qwen-Image-Layered
no es ejecutable con este presupuesto. Ambos se evaluaron a partir de su documentación y
artículo (no se ejecutaron).

## 5. Identificación de la fuente

No hay un modelo abierto fiable para identificar fuentes de Google Fonts con licencia clara, así
que se usa un método propio sin red neuronal (`text.comparar_fuentes`): se renderiza el texto
leído con cada una de las 45 familias (y sus pesos) de la biblioteca libre (`assets/fonts`), se
normaliza a la caja de la tinta y se puntúa la superposición (IoU suavizado), la densidad de
trazo y la proporción ancho/alto. Se proponen las **3 más parecidas** con su puntuación. Después
se ajustan tamaño y espaciado maximizando la superposición. Resultado en las pruebas: la fuente
correcta aparece en primera posición (y en el top-3) en 13 de los 14 textos de prueba.

## 6. Opción en la nube (desactivada por defecto)

Adaptador para la API oficial de imágenes de OpenAI (`/v1/images/edits`), solo para relleno
generativo (ampliar el fondo o generar un elemento a partir de una descripción). Coste por imagen
generada según la [guía oficial](https://developers.openai.com/api/docs/guides/image-generation)
y la [página de precios](https://developers.openai.com/api/docs/pricing) (31-10-2026; los tokens de
la imagen enviada se cobran aparte):

| Modelo | Calidad baja | Media | Alta (1024×1024) |
|---|---|---|---|
| gpt-image-1-mini (por defecto) | 0,005 $ | 0,011 $ | 0,036 $ |
| gpt-image-1.5 | 0,009 $ | 0,034 $ | 0,133 $ |
| gpt-image-2 | 0,006 $ | 0,053 $ | 0,211 $ |

Formatos 1536×1024 / 1024×1536: mini 0,006 / 0,015 / 0,052 $. Verifica los precios antes de
activarlo: cambian con frecuencia y algunos modelos se retiran (gpt-image-1 se retiró el
23-10-2026).
