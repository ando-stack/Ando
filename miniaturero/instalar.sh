#!/usr/bin/env bash
# Instala (o comprueba) todo lo que necesita el miniaturero. Se puede ejecutar varias veces.
set -euo pipefail
cd "$(dirname "$0")"
M=modelos; F=assets/fonts
mkdir -p "$M" "$F"

echo "== Librerías de Python"
python3 -m pip install -q opencv-python-headless numpy pillow onnxruntime onnx 2>&1 | grep -v "WARNING: Running pip as" || true

echo "== Playwright (Node) para renderizar HTML a PNG"
if ! node -e "require('playwright')" 2>/dev/null; then
  npm install --prefix herramientas playwright@1.63.0 && npx --prefix herramientas playwright install chromium
fi

baja() { # baja <url> <destino>
  [ -s "$2" ] && { echo "   ya está: $2"; return; }
  echo "   descargando $2"; curl -fsSL --retry 4 -o "$2.part" "$1" && mv "$2.part" "$2"
}
HF=https://huggingface.co

echo "== Modelos (todos desde Hugging Face)"
baja "$HF/onnx-community/BiRefNet-ONNX/resolve/main/onnx/model.onnx"                  "$M/birefnet.onnx"          # recorte (MIT)
baja "$HF/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx"                               "$M/lama_fp32.onnx"         # relleno (Apache-2.0)
baja "$HF/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx" "$M/yunet.onnx"            # caras (MIT)
baja "$HF/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx"       "$M/depth_anything_v2_small.onnx" # profundidad para iluminar (Apache-2.0)
# Sustitución de caras: SOLO USO NO COMERCIAL (ver docs/licencias.md)
baja "$HF/facefusion/models-3.0.0/resolve/main/inswapper_128.onnx"                   "$M/inswapper_128.onnx"
baja "$HF/facefusion/models-3.0.0/resolve/main/arcface_w600k_r50.onnx"               "$M/arcface_w600k_r50.onnx"
baja "$HF/facefusion/models-3.0.0/resolve/main/gfpgan_1.4.onnx"                      "$M/gfpgan_1.4.onnx"

echo "== Fuentes (Google Fonts, licencia libre)"
GF=https://raw.githubusercontent.com/google/fonts/main
for f in ofl/anton/Anton-Regular.ttf ofl/bebasneue/BebasNeue-Regular.ttf ofl/bangers/Bangers-Regular.ttf \
         apache/luckiestguy/LuckiestGuy-Regular.ttf ofl/archivoblack/ArchivoBlack-Regular.ttf \
         "ofl/montserrat/Montserrat[wght].ttf" "ofl/oswald/Oswald[wght].ttf" ofl/poppins/Poppins-Black.ttf \
         ofl/poppins/Poppins-ExtraBold.ttf "ofl/teko/Teko[wght].ttf" apache/permanentmarker/PermanentMarker-Regular.ttf; do
  n=$(basename "$f" | sed 's/\[wght\]/-Variable/'); baja "$GF/$(echo "$f" | sed 's/\[/%5B/;s/\]/%5D/')" "$F/$n"
done
baja "$GF/ofl/anton/OFL.txt" "$F/OFL.txt"
baja "$GF/apache/luckiestguy/LICENSE.txt" "$F/APACHE-2.0.txt"
echo "== Listo"
