# Buenas prácticas para escribir skills

## Contenido
- Nombre
- Descripción (la parte más importante)
- Cuerpo de SKILL.md
- Qué va en SKILL.md y qué va fuera
- Scripts
- Archivos de referencia
- Errores frecuentes

## Nombre

- Describe la actividad, preferiblemente en gerundio: `procesando-facturas`,
  `revisando-contratos`. También valen sustantivos (`analisis-ventas`).
- Evita nombres vagos: `helper`, `utils`, `tools`, `documentos`, `datos`.
- Sin tildes ni eñes: `disenando-logos`, no `diseñando-logos`.

## Descripción (la parte más importante)

Es lo único que Claude ve antes de decidir si usa la skill. Fórmula:

> **[Qué hace, con verbos concretos y objetos concretos].** Usar cuando el usuario
> [situaciones y palabras reales que usaría], incluso si no menciona [término técnico].
> No usar para [casos parecidos fuera de alcance].

- Tercera persona: «Genera…», «Revisa…». Nunca «Puedo…» ni «Puedes usar…».
- Incluye los términos del usuario: formatos (CSV, .xlsx), verbos («resume», «limpia»),
  sinónimos y la versión coloquial («pásame esto a tabla»).
- Algo insistente: Claude tiende a no activar skills cuando dudaría. «Úsala siempre que…».
- Añade «No usar para…» solo si hay un caso vecino real que podría confundirse.
- Para claude.ai, intenta caber en 200 caracteres; si no, prioriza el qué y el cuándo al principio.

Ejemplo bueno:
`Resume archivos CSV: filas, columnas, tipos, vacíos y estadísticas. Usar cuando el usuario comparta un .csv o pida analizar, describir o resumir datos tabulares.`

Ejemplos malos: `Ayuda con datos.` (vago) · `Puedo analizar tus CSV.` (primera persona).

## Cuerpo de SKILL.md

Secciones recomendadas, en este orden (omite las que no aporten):

1. **Objetivo**: una o dos frases.
2. **Cuándo usarla / cuándo no**: refuerza la descripción con casos frontera.
3. **Flujo de trabajo**: pasos numerados en imperativo. Para flujos largos, un checklist
   que Claude copie y marque.
4. **Formato de salida**: plantilla exacta si importa la forma.
5. **Reglas y restricciones**: lo que nunca o siempre debe hacer.
6. **Casos límite y errores**: qué hacer si falta un dato, el archivo no existe, etc.
7. **Ejemplos**: pares entrada → salida concretos.
8. **Recursos**: lista de archivos de referencia y scripts, con cuándo usarlos.

Estilo:
- Imperativo y directo: «Lee…», «Ejecuta…», «Pregunta…».
- Claude ya sabe mucho: no expliques conceptos generales; da solo el contexto propio.
- Un término por concepto en todo el texto.
- Una opción por defecto en lugar de una lista de alternativas.
- Sin fechas que caduquen («antes de agosto de 2025…»).
- Rutas siempre con `/`.

## Qué va en SKILL.md y qué va fuera

| En SKILL.md | En archivos de referencia | En scripts |
|-------------|---------------------------|------------|
| Flujo principal, reglas, formato de salida, 1–3 ejemplos cortos | Documentación extensa, tablas, catálogos, guías de marca, esquemas de API, ejemplos largos | Operaciones deterministas o frágiles: cálculos, conversiones, validaciones |

Señales para sacar contenido de SKILL.md: más de 500 líneas, secciones que solo se
necesitan en algunos casos, tablas de datos.

## Scripts

- Python 3 con biblioteca estándar siempre que sea posible; si hace falta un paquete,
  dilo en SKILL.md (y en `compatibility`).
- Deterministas: misma entrada → misma salida.
- Gestionan sus errores con mensajes claros (qué pasó, en qué archivo/línea, cómo
  arreglarlo) y códigos de salida distintos de 0.
- Sin constantes mágicas: comenta por qué cada valor.
- Nunca claves, tokens ni contraseñas: léelas de variables de entorno.
- No modifican archivos fuera de lo que el usuario indique.
- En SKILL.md indica si Claude debe **ejecutar** el script (lo normal) o **leerlo**, con
  el comando exacto y un ejemplo de salida.

## Archivos de referencia

- Enlázalos todos directamente desde SKILL.md (un solo nivel) y di **cuándo** leer cada uno.
- Nombres descriptivos: `reference/tono-de-voz.md`, no `doc2.md`.
- Si pasan de 100 líneas, empieza con una sección «Contenido».
- Organízalos por dominio para que Claude lea solo el necesario.

## Errores frecuentes

- Descripción que dice qué hace pero no cuándo usarla.
- Instrucciones de «cuándo usarla» solo en el cuerpo (Claude no las ve antes de activarla).
- SKILL.md enorme con todo dentro.
- Enlaces a archivos que no existen o con barras invertidas.
- Varios SKILL.md en la misma skill (claude.ai rechaza el paquete).
- Campos de Claude Code en una skill que se va a subir a claude.ai.
- Valores YAML con `: ` sin comillas.
