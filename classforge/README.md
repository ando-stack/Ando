# ClassForge AI

Sube los documentos de tu profesor (Word, Excel, PowerPoint, PDF, CSV, imágenes) y obtén **los archivos del trabajo realizados**: reales, editables, verificados y descargables. No es un chatbot: el resultado son archivos.

```
Navegador (Next.js)  ──►  FastAPI  ──►  1 Ingesta ─► 2 Interpretación ─► 3 Planificación ─► 4 Ejecución ─► 5 Validación ─► 6 Entrega
                                         (python-docx,   (Claude, salida    (Claude, plan JSON   (funciones       (reabrir archivos,
                                          openpyxl,       estructurada)      validado con         controladas:     recalcular fórmulas
                                          PyMuPDF…)                          esquemas estrictos)  sin ejecutar     con LibreOffice,
                                                                                                  código de la IA) revisión con IA)
```

## Puesta en marcha

Requisitos: Python 3.11+, Node 20+ y (recomendado) LibreOffice para convertir a PDF y recalcular fórmulas.

```bash
cd classforge/backend
pip install -r requirements-dev.txt
cp .env.example .env   # y pon tu ANTHROPIC_API_KEY
```

```bash
cd classforge/frontend
npm install
cp .env.example .env.local
```

```bash
cd classforge
./iniciar.sh
```

Abre http://localhost:3000. Para tener documentos de prueba: `python scripts/generar_ejemplos.py ejemplos`.

Sin `ANTHROPIC_API_KEY` la aplicación permite subir y leer documentos, pero **se niega** a analizarlos o generarlos (error 503 explícito). No hay respuestas simuladas.

### Pruebas

```bash
cd classforge/backend
python -m pytest -q
```

37 pruebas generan documentos de ejemplo tipo «Digitalización» (plantilla Word con huecos y tabla, libro Excel de ventas, enunciado PDF, CSV de notas, imagen) y comprueban sobre los archivos reales: huecos rellenados conservando formato, inserción en la posición correcta, tablas, estilos, encabezados, fórmulas con **valores recalculados** (SUM, AVERAGE, MAX, IVA…), gráficos nativos, formato condicional, validaciones, PPTX con tabla/gráfico/notas, PDF nuevos y convertidos, formularios PDF, CSV filtrados, rechazo de fórmulas peligrosas, aislamiento entre usuarios, límites de uso, limpieza, reparación de planes inválidos y el flujo HTTP completo. Las llamadas a Claude se sustituyen en los tests por un doble determinista; la app real siempre llama a la API.

## Arquitectura

| Ruta | Función |
|---|---|
| `backend/app/main.py` | API REST: subida, análisis, generación, correcciones, descargas, vista previa, ZIP, historial |
| `backend/app/pipeline.py` | Orquesta las 6 etapas y el progreso |
| `backend/app/ingest/` | Etapa 1: extrae texto, tablas, estructura (índices `[Pn]`, `[Tn Rr Cc]`, celdas, hojas, diapositivas), huecos de plantilla e imágenes (visión) |
| `backend/app/ai/` | Cliente Claude (salidas estructuradas + streaming + fallback), prompts y esquemas Pydantic |
| `backend/app/tools/` | **Catálogo de 42 operaciones documentales** (`docx.*`, `xlsx.*`, `pptx.*`, `pdf.*`, `csv.*`) con argumentos validados por esquema |
| `backend/app/executor.py` | Etapa 4: valida el plan y lo traduce a llamadas del catálogo |
| `backend/app/validate/` | Etapa 5: reabre archivos, ejecuta las comprobaciones de cada operación, conserva plantilla, errores de fórmula, cobertura de requisitos |
| `backend/app/preview.py` | Vistas previas HTML (sin scripts) |
| `frontend/` | Next.js 15 + TypeScript + Tailwind (tema oscuro por defecto) |

**Añadir una herramienta**: define un modelo `Args` y una función con `@register("formato.nombre", "formato", Modelo, "descripción")` en `backend/app/tools/`. Aparece sola en el catálogo que ve la IA, se valida y se ejecuta.

### Cómo trabaja la IA

1. **Interpretación** — Claude recibe todos los documentos (texto estructurado + imágenes) y devuelve, con esquema estricto: ejercicios, requisitos atómicos con su origen (sin inventar), recursos, entregables (con plantilla base si la hay), herramientas, ambigüedades, imposibles e instrucciones sospechosas.
2. **Planificación** — devuelve un plan JSON: por entregable, una lista de operaciones del catálogo con sus argumentos, los requisitos que cubre y una explicación didáctica («Fórmulas › Autosuma…»). El servidor valida cada operación; si algo no cuadra, se lo devuelve a Claude una vez para que lo corrija.
3. **Revisión** — tras generar, Claude compara los archivos reextraídos con la lista de requisitos.

El prompt de sistema y los documentos son idénticos en las tres llamadas para aprovechar la caché de prompts.

## Seguridad

- La clave de API solo existe en el servidor; el navegador nunca la ve.
- Cada navegador tiene un identificador aleatorio (cabecera `X-Client-Token`); el servidor guarda solo su hash. Los trabajos y archivos tienen identificadores de 192 bits y un trabajo ajeno responde «404» igual que uno inexistente.
- Validación de tipo por firma real (no solo extensión), tamaño, número de archivos, ZIP bombs y macros.
- La IA no ejecuta código: solo propone operaciones del catálogo, validadas con Pydantic (`extra="forbid"`). Fórmulas con funciones externas (`WEBSERVICE`, DDE, libros externos…) se rechazan. Nombres de archivo saneados, sin rutas.
- Anti-inyección: los documentos van marcados como datos no confiables; un detector heurístico y la propia IA señalan textos que intentan manipular el sistema, y se muestran al usuario.
- Límites de uso por cliente e IP (trabajos/día, llamadas IA/hora) y borrado automático de archivos tras `CLASSFORGE_RETENTION_HOURS`.
- Vistas previas servidas con CSP `default-src 'none'` y mostradas en un `iframe` con `sandbox`.

## Estado por fases

| Fase | Estado |
|---|---|
| 1. Interfaz y subida | Hecho: drag & drop, tarjetas, validación, nombre/fecha recordados, tema oscuro, responsive |
| 2. Extracción y análisis con Claude | Hecho (necesita `ANTHROPIC_API_KEY` para funcionar) |
| 3. DOCX | Hecho: rellenar huecos conservando formato, insertar en posición, tablas, filas, imágenes, gráficos, listas, estilos, encabezado/pie con nº de página, márgenes, orientación, índice |
| 4. XLSX | Hecho: celdas, fórmulas (con relleno relativo), hojas, formatos, gráficos nativos, formato condicional, validaciones, nombres, inmovilizar, filtros, ordenar, importar CSV, impresión |
| 5. PDF, PPTX, CSV, imágenes | Hecho: PDF nuevo (ReportLab), conversión DOCX/XLSX/PPTX→PDF (LibreOffice), rellenar formularios y escribir en PDF; PPTX nuevo o sobre plantilla; CSV escribir/transformar; imágenes por visión |
| 6. Validación, historial, vistas previas | Hecho |

### Limitaciones conocidas (no se simulan)

- **Sin clave de API no hay análisis**: el sistema lo indica y no inventa resultados.
- El índice (TOC) de Word es un campo: Word pide «actualizar campos» al abrir.
- Las fórmulas se guardan sin valor calculado; Excel las calcula al abrir. El **servidor** solo puede comprobar sus resultados si LibreOffice está instalado (si no, se avisa en la validación).
- Conversión a PDF de documentos editados: requiere LibreOffice.
- Tablas dinámicas, macros, SmartArt, ecuaciones de Word y edición de PDF escaneados no están en el catálogo: la IA los marca como «no resueltos».
- Las imágenes de entrada se interpretan con visión, pero el sistema no dibuja diagramas libres (sí gráficos de datos).
- Los límites de uso se guardan en memoria: para varios procesos/servidores habría que moverlos a Redis.
