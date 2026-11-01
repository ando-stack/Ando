# Licencias de modelos, fuentes y recursos

Revisado el 2026-11-01 en las fuentes originales (ficheros LICENSE de cada repositorio y fichas de Hugging Face).
Si una licencia cambia, actualiza esta tabla antes de seguir usando el recurso.

## Modelos

| Uso | Modelo | Descargado de | Licencia | ¿Comercial? |
|---|---|---|---|---|
| Quitar fondo | **BiRefNet** (export ONNX) | `huggingface.co/onnx-community/BiRefNet-ONNX` (original: `ZhengPeng7/BiRefNet`) | MIT | ✅ Sí |
| Relleno inteligente | **LaMa** (big-lama, export ONNX `lama_fp32.onnx`) | `huggingface.co/Carve/LaMa-ONNX` (original: `advimman/lama`) | Apache-2.0 | ✅ Sí |
| Detección de caras | **YuNet** 2023mar | `huggingface.co/opencv/face_detection_yunet` | MIT | ✅ Sí |
| Sustitución de cara | **inswapper_128** (InsightFace) | `huggingface.co/facefusion/models-3.0.0` | Modelos InsightFace: **solo investigación no comercial**. Desde 2025-11 InsightFace pide contactar con `contact@insightface.ai` para licenciar inswapper. | ❌ **No** |
| Identidad de la cara (para el anterior) | **ArcFace w600k_r50** (buffalo_l, InsightFace) | `huggingface.co/facefusion/models-3.0.0` | Igual que arriba: **no comercial** | ❌ **No** |
| Mejorar la cara tras el cambio | **GFPGAN 1.4** | `huggingface.co/facefusion/models-3.0.0` (original: `TencentARC/GFPGAN`) | Apache-2.0 *con componentes de terceros*; parte del código deriva de StyleGAN2 (licencia NVIDIA) y DFDNet (CC BY-NC-SA 4.0) | ⚠️ Tratar como **no comercial** |

Librerías: onnxruntime (MIT), OpenCV (Apache-2.0), Pillow (MIT-CMU), NumPy (BSD), onnx (Apache-2.0), Playwright (Apache-2.0), Chromium (BSD y otras).

### Qué significa en la práctica
- **Recortar, borrar elementos, detectar caras, componer y renderizar**: todo con licencias que permiten uso comercial. Sirve para un canal monetizado.
- **"Cambiar solo la cara"** (inswapper + ArcFace + GFPGAN): **solo para uso personal/no comercial**. Si el canal está monetizado o es para un cliente, la alternativa es **"cambiar la persona completa"** (recorte de tu foto + relleno con LaMa), que no usa esos modelos.
- Antes de cada cambio de cara en un encargo, el miniaturero debe recordarlo y preguntar si el uso es comercial.

## Fuentes (carpeta `assets/fonts/`, descargadas de `github.com/google/fonts`)

| Fuente | Licencia |
|---|---|
| Anton, Bebas Neue, Bangers, Archivo Black, Montserrat, Oswald, Poppins (Black, ExtraBold), Teko | SIL Open Font License 1.1 (`OFL.txt`) |
| Luckiest Guy, Permanent Marker | Apache License 2.0 (`APACHE-2.0.txt`) |

Todas permiten uso comercial en imágenes.

## Imágenes de prueba
- `chelsea.png` (gato) del paquete de datos de scikit-image: CC0, autor Stéfan van der Walt. Usada en la miniatura de prueba.

## Generación de imágenes con IA
Desactivada. Si se activa, anotar aquí proveedor, modelo, condiciones de uso y coste por imagen.
