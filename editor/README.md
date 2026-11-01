# Estudio de Capas

Editor de diseño gráfico local y gratuito para **miniaturas de YouTube y pósters deportivos**:
subes una imagen de inspiración, la IA la **separa en capas editables** (fondo reconstruido,
personas y objetos recortados, **textos editables** con una fuente parecida, y elementos
gráficos) y la modificas a tu gusto en un editor tipo Photoshop/Canva antes de exportarla.

- Todo funciona **en tu equipo y sin pagar**: modelos de código abierto con licencias que
  permiten uso comercial. Las imágenes no salen de tu ordenador.
- Funciona **con o sin GPU** (NVIDIA CUDA, Apple Silicon MPS o solo CPU, detección automática).
- La única opción de pago (relleno generativo en la nube) está **desactivada** y pide
  confirmación con el coste antes de enviar nada.

> Aviso de derechos de autor: si subes una imagen de otra persona, úsala como inspiración y
> sustituye fotos, logotipos y textos por los tuyos antes de publicar. El editor no incluye
> ninguna función para quitar marcas de agua.

## Qué hace

1. **Descomposición en capas** (35–65 s por imagen en CPU):
   - Textos → capas de texto **editables** con contenido, posición, giro, tamaño, color de relleno
     (o degradado), uno o varios **contornos** con su grosor, **sombra** y las **3 fuentes libres
     más parecidas**. Si un texto no se puede reproducir fielmente queda como imagen recortada,
     con aviso y un botón para recrearlo como texto.
   - Personas y objetos → capas recortadas con transparencia y bordes finos (pelo incluido).
   - Gráficos simples (bandas, rectángulos, círculos, flechas, insignias) → capas separadas.
   - Fondo reconstruido sin textos ni sujetos (relleno inteligente).
   - Imagen original como capa **bloqueada** de referencia, similitud de la reconstrucción y
     **confianza** de cada capa.
2. **Editor**: zoom, desplazamiento, reglas, guías (arrastrando desde la regla), guías
   inteligentes y ajuste a la cuadrícula; panel de capas (arrastrar para reordenar, mostrar,
   bloquear, renombrar, duplicar, agrupar, unir, dividir, opacidad y 16 modos de fusión);
   herramientas de texto, formas, imágenes, máscaras, borrar con IA, segmentar, ajustes y efectos;
   deshacer/rehacer ilimitado, guardado automático y proyectos recientes.
3. **Formatos y exportación** a PNG/JPG/WebP respetando el peso máximo, exportación de capas por
   separado y vista previa en el móvil.

## Requisitos

| | Mínimo | Recomendado |
|---|---|---|
| Python | 3.10 (probado con 3.10 y 3.13) | 3.11+ |
| Node.js | 18 (para compilar el editor) | 20 o 22 LTS |
| RAM | 8 GB (usa un recorte más ligero) | 16 GB |
| Disco | 6 GB (dependencias + 1,7 GB de modelos) | |
| GPU | ninguna (CPU: 35–65 s por imagen) | NVIDIA con 6 GB+ (CUDA) o Apple Silicon (MPS) |

Sin GPU todo funciona igual, solo más despacio. Con GPU NVIDIA hacen falta los controladores
recientes de NVIDIA (comprueba que `nvidia-smi` funciona).

## Instalación

```bash
git clone <este repositorio>
cd Ando/editor
python3 scripts/instalar.py
```

En Windows usa `python scripts\instalar.py`. El instalador:

1. comprueba Python, Node.js, la GPU, la RAM y el disco (solo comprobar: `--comprobar`);
2. crea el entorno `.venv` e instala `requirements.txt` (versiones fijadas; PyTorch con CUDA si
   hay GPU NVIDIA, `--cpu` para forzar CPU);
3. **descarga los modelos** (~1,7 GB) y verifica sus sumas de control (solo modelos:
   `--modelos`);
4. verifica las fuentes incluidas, compila el editor (`--sin-web` para omitirlo) y crea `.env`.

## Arrancar

```bash
scripts/iniciar.sh
```

En Windows: `scripts\iniciar.bat`. Abre **http://127.0.0.1:8000**.

Modo desarrollo (recarga en caliente del editor en http://127.0.0.1:5173):

```bash
scripts/iniciar.sh --dev
```

## Guía rápida del editor

1. **Proyectos → Sube una imagen de inspiración** (o arrástrala). Espera a que termine la
   separación en capas. En **Propiedades** verás la similitud con el original y avisos; cada capa
   muestra un punto de confianza (verde ≥ 75 %, ámbar ≥ 50 %, rojo).
2. **Seleccionar (V)**: haz clic en una capa del lienzo o del panel; arrastra para mover, usa las
   asas para escalar y girar. Mayús+clic para seleccionar varias.
3. **Textos**: doble clic para escribir en el lienzo o edita en Propiedades → *Texto*: fuente (las
   3 parecidas propuestas por la IA, la biblioteca libre, cualquier Google Font por nombre o tu
   propia fuente), tamaño, color sólido o degradado, varios contornos, sombra, resplandor, 3D,
   inclinación, espaciado, alineación y curvatura. Prueba los **estilos predefinidos**.
4. **Reemplazar**: en una capa de imagen, *Reemplazar imagen…* (con o sin quitar el fondo).
   **Importar** una foto propia con el icono de imagen de la barra izquierda.
5. **Máscaras**: selecciona una capa de imagen y pinta con el **borrador (E)** para ocultar o el
   **pincel de máscara (B)** para recuperar. No destruye la imagen.
6. **Borrar objeto con IA (J)**: pinta sobre lo que quieras quitar del fondo (o de la capa
   seleccionada) y se rellena automáticamente.
7. **Segmentar (S)**: haz clic sobre algo de la imagen original (Alt+clic para excluir zonas) o
   píntalo; luego *Crear capa* o *Crear y quitar del origen*.
8. **Efectos y texturas**: luces, destellos, humo, chispas, grano y semitono; en capas de imagen,
   contorno alrededor del recorte, resplandor de borde, sombra y ajustes (brillo, contraste,
   saturación, temperatura, nitidez, desenfoque y filtros de color).
9. **Formato** (barra superior): cambia el lienzo con recolocación automática de las capas.
10. **Exportar**: elige formato y calidad; se respeta el peso máximo del formato.
    **Vista previa en el móvil** muestra cómo se ve la miniatura entre resultados neutros.

## Atajos de teclado

| Atajo | Acción |
|---|---|
| V · H (o mantener Espacio) · T · U | Seleccionar · Mano · Texto · Formas |
| E · B | Borrador de máscara · Pincel de máscara |
| J · S · I | Borrar con IA · Segmentar · Cuentagotas |
| [ · ] | Tamaño del pincel |
| Ctrl+Z · Ctrl+Shift+Z / Ctrl+Y | Deshacer · Rehacer (ilimitado) |
| Ctrl+D · Supr | Duplicar · Eliminar |
| Ctrl+G · Ctrl+Shift+G | Agrupar · Desagrupar |
| Ctrl+E | Unir capas seleccionadas |
| Ctrl+] · Ctrl+[ (con Shift: al frente/al fondo) | Subir · Bajar capa |
| Flechas (Shift ×10) | Mover 1 px (10 px) |
| Shift+H · Shift+V | Voltear horizontal · vertical |
| Ctrl+A · Esc | Seleccionar todo · Deseleccionar |
| Ctrl+0 · Ctrl+1 · Ctrl+rueda · + / − | Encajar · 100 % · Zoom |
| Ctrl+' · Ctrl+R | Cuadrícula · Reglas |
| Ctrl+S · Ctrl+Shift+E | Guardar · Exportar |
| ? | Ver todos los atajos |

## Formatos de exportación

| Formato | Tamaño | Peso máximo |
|---|---|---|
| Miniatura YouTube (4K, recomendado por YouTube) | 3840 × 2160 | 50 MB (subida desde ordenador) |
| Miniatura YouTube (subida desde móvil) | 1280 × 720 | 2 MB |
| Póster Instagram 4:5 | 1080 × 1350 | — |
| Instagram 1:1 | 1080 × 1080 | — |
| Historia / vertical 9:16 | 1080 × 1920 | — |
| Cabecera de X | 1500 × 500 | 5 MB |
| Póster A4 a 300 ppp | 2480 × 3508 | — |
| Póster A3 a 300 ppp | 3508 × 4961 | — |

Datos de YouTube verificados en su [ayuda oficial](https://support.google.com/youtube/answer/72431)
(31-10-2026): 3840×2160 recomendado, 16:9, ancho mínimo 640 px, JPG o PNG, 50 MB desde ordenador
y 2 MB desde móvil. Exporta a **PNG** (sin pérdida; si supera el peso se reducen colores),
**JPG** o **WebP** (calidad configurable; si se supera el peso se baja la calidad lo justo). También
puedes **exportar cada capa** como PNG con transparencia en un ZIP.

## Licencias

- Modelos: BiRefNet (MIT), RT-DETRv2, SAM 2.1, ViTMatte, PP-OCRv6 y Big-LaMa (Apache-2.0); todos
  permiten uso comercial. Detalles, fuentes, rendimiento y alternativas descartadas en
  [docs/modelos.md](docs/modelos.md).
- Fuentes (45 familias, SIL OFL 1.1), efectos y texturas (obra propia, CC0) e iconos (Lucide, ISC):
  [assets/LICENSES.md](assets/LICENSES.md).
- Imágenes de prueba: [test-images/README.md](test-images/README.md).

## Opciones en la nube (desactivadas por defecto)

**Relleno generativo** con la API oficial de imágenes de OpenAI: ampliar el fondo o generar un
elemento a partir de una descripción. Coste por imagen generada (más los tokens de la imagen
enviada): `gpt-image-1-mini` 0,005 $ (baja), **0,011 $ (media, por defecto)**, 0,036 $ (alta) a
1024×1024; `gpt-image-2` 0,006 / 0,053 / 0,211 $. Consulta la
[página de precios](https://developers.openai.com/api/docs/pricing) antes de activarlo.

Para activarlo: copia `.env.example` a `.env`, pon `NUBE_ACTIVADA=true` y tu `OPENAI_API_KEY`, y
reinicia. El editor muestra un aviso claro, el coste estimado y exige confirmar cada envío.
`.env` está en `.gitignore`: las claves nunca van en el código.

## Desarrollo y pruebas

```bash
.venv/bin/python -m pytest tests -q
```

```bash
cd web && npm test && npm run build
```

```bash
.venv/bin/python scripts/evaluar_descomposicion.py
```

Con el motor arrancado, prueba de extremo a extremo en un navegador real (Playwright):

```bash
node tests/e2e/flujo.mjs http://127.0.0.1:8000
```

Estructura: `engine/` (motor Python), `web/` (editor), `assets/` (fuentes, efectos, licencias),
`docs/` (modelos y arquitectura), `projects/` (tus proyectos), `test-images/` (pruebas),
`scripts/` (instalación, arranque, evaluación y generación de recursos).

## Limitaciones conocidas

- En CPU la descomposición tarda 35–65 s y BiRefNet usa ~8 GB de RAM de forma transitoria (con
  menos RAM libre se usa un recorte más ligero automáticamente).
- El OCR puede juntar palabras muy próximas (p. ej. «LOPROBARÍAS») u omitir signos de apertura
  (se recuperan «¡» y «¿» por su forma en la mayoría de los casos). Revisa los textos.
- Fuentes muy decorativas o que no están en la biblioteca se aproximan con la más parecida; los
  textos con texturas o fotos dentro de las letras se dejan como imagen.
- Rótulos pequeños que forman parte de la foto (logotipos en camisetas, carteles) se dejan en el
  fondo a propósito.
- El relleno de huecos grandes (detrás de una persona) es aproximado: suele quedar tapado por el
  sujeto, pero si lo mueves mucho conviene retocar el fondo.
- Las máscaras se aplican a capas de imagen; para texto y formas, primero *Rasterizar capa*.
