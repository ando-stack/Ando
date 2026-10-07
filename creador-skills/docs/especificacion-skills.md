# Especificación de Agent Skills (resumen)

**Fecha de consulta:** 2026-10-07
**Versión de Claude Code comprobada en este entorno:** 2.1.292

Este documento resume la documentación oficial vigente en la fecha indicada. Todo el
proyecto (`skill-builder`, scripts, plantillas y ejemplos) se basa en él. Cuando las
fuentes oficiales no coinciden o algo no está documentado, se indica expresamente y se
elige la opción más conservadora.

## Fuentes consultadas

| # | Fuente | URL |
|---|--------|-----|
| F1 | Agent Skills – visión general (plataforma) | https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview |
| F2 | Buenas prácticas de autoría de skills | https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices |
| F3 | Skills en Claude Code | https://code.claude.com/docs/en/skills |
| F4 | Especificación abierta Agent Skills | https://agentskills.io/specification |
| F5 | Centro de ayuda: crear skills personalizadas (claude.ai) | https://support.claude.com/en/articles/12512198-creating-custom-skills |
| F6 | Repositorio oficial de skills de Anthropic | https://github.com/anthropics/skills |
| F7 | Skill oficial `skill-creator` (copia local en `/mnt/skills/examples/skill-creator`, idéntica a la publicada en F6) | https://github.com/anthropics/skills/tree/main/skills/skill-creator |

Nota: `docs.claude.com/en/docs/agents-and-tools/agent-skills/*` redirige (302) a
`platform.claude.com/docs/...`; se han usado las URL finales.

---

## 1. Estructura de carpetas

Una skill es una carpeta que contiene, como mínimo, un archivo `SKILL.md` (F1, F4):

```
nombre-de-la-skill/
├── SKILL.md          # Obligatorio: frontmatter YAML + instrucciones en Markdown
├── scripts/          # Opcional: código ejecutable
├── references/       # Opcional: documentación que se lee bajo demanda (F4 usa "references/")
├── assets/           # Opcional: plantillas, imágenes, datos
└── ...               # Cualquier otro archivo o carpeta
```

- El nombre del archivo es `SKILL.md` (F1, F3, F4). F5 lo escribe como `skill.md`; se
  usa `SKILL.md`, que es la forma de la especificación y de Claude Code.
- La carpeta debe llamarse igual que el campo `name` (F4: "Must match the parent
  directory name"; F5: "Ensure the folder name matches your skill's name").
- Una skill debe contener **un único** `SKILL.md`. La skill oficial `skill-creator` (F7)
  advierte de que claude.ai y la API rechazan paquetes con varios `SKILL.md`; solo el
  sistema de archivos de Claude Code carga skills anidadas.
- Los nombres de subcarpetas (`scripts/`, `references/`, `assets/`) son
  **recomendaciones**, no obligaciones (F4). F2 usa también `reference/`. Este proyecto
  usa `reference/` para la skill creadora (como pide el encargo) y acepta ambas.

## 2. Frontmatter YAML

### 2.1 Campos de la especificación (F1, F2, F4)

| Campo | Obligatorio | Restricciones |
|-------|-------------|---------------|
| `name` | Sí | 1–64 caracteres. Solo minúsculas `a-z`, dígitos `0-9` y guiones `-`. No puede empezar ni acabar en guion ni contener `--` (F4). No puede contener etiquetas XML ni las palabras reservadas **`anthropic`** y **`claude`** (F1, F2). Debe coincidir con el nombre de la carpeta (F4). |
| `description` | Sí | 1–1024 caracteres, no vacía, sin etiquetas XML (F1, F2, F4). Debe decir **qué hace** la skill y **cuándo usarla** (F1). En tercera persona (F2). |
| `license` | No | Nombre de licencia o referencia a un archivo incluido (F4). |
| `compatibility` | No | 1–500 caracteres. Requisitos de entorno (F4, F3). |
| `metadata` | No | Mapa de claves texto → valores texto (F4). |
| `allowed-tools` | No | Herramientas preaprobadas. Experimental (F4). |

### 2.2 Campos adicionales de Claude Code (F3)

En Claude Code **todos** los campos son opcionales (si falta `name`, se usa el nombre de
la carpeta) y Claude Code **ignora en silencio** los campos que no reconoce. Campos
propios: `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`,
`user-invocable`, `disallowed-tools`, `model`, `effort`, `context`, `agent`,
`background`, `hooks`, `paths`, `shell`.

- `description` + `when_to_use` se truncan a **1536 caracteres** en el listado de skills.
- Nombres reservados en Claude Code: `synced` y `anthropic-skills`.

### 2.3 Diferencias entre fuentes y decisión conservadora

| Punto | Discrepancia | Decisión en este proyecto |
|-------|--------------|---------------------------|
| `name` obligatorio | Obligatorio en F1/F2/F4; opcional en Claude Code (F3). | Obligatorio siempre. |
| Longitud de `description` | 1024 en F1/F2/F4; F5 (centro de ayuda de claude.ai) indica **200 caracteres máximo**. | Error si > 1024. **Aviso** si > 200 (posible rechazo en claude.ai); con `--estricto` pasa a error. |
| Formato de `name` en claude.ai | F5 muestra un ejemplo "Brand Guidelines" (con espacios y mayúsculas), que contradice F1/F4. | Se aplican siempre las reglas estrictas de F1/F4. |
| Campos de Claude Code | Claude Code los acepta; el empaquetador oficial (F7) **rechaza** cualquier campo fuera de `name, description, license, allowed-tools, metadata, compatibility`. | Para destino claude.ai son **error**; para solo Claude Code, válidos. |
| Campo `dependencies` | Solo aparece en F5, no en la especificación. | Aviso: no estándar. |
| Ángulos `<` `>` en `description` | F1 prohíbe "etiquetas XML"; F7 prohíbe cualquier `<` o `>`. | Error ante cualquier `<` o `>`. |
| Campos desconocidos | Claude Code los ignora sin avisar; F7 los rechaza. | Error (probablemente una errata). |

## 3. Cómo decide Claude cuándo usar una skill

- Al iniciar, solo se cargan `name` y `description` de cada skill en el prompt del
  sistema (~100 tokens por skill) (F1).
- La `description` es lo que Claude compara con la petición para decidir si activa la
  skill; por eso debe incluir **qué hace y cuándo usarla**, con los términos que usaría
  el usuario (F1, F2). Claude puede elegir entre más de 100 skills (F2).
- En Claude Code la skill se invoca mediante la herramienta `Skill` (visible en el
  transcript) o manualmente con `/nombre` (F3). `disable-model-invocation: true` impide
  la invocación automática.
- La skill oficial F7 recomienda descripciones algo "insistentes" porque Claude tiende a
  **infra-activar** skills.

## 4. Carga progresiva (progressive disclosure)

| Nivel | Cuándo se carga | Coste | Contenido |
|-------|-----------------|-------|-----------|
| 1. Metadatos | Siempre, al inicio | ~100 tokens por skill | `name` + `description` |
| 2. Instrucciones | Al activarse la skill | < 5000 tokens recomendado | Cuerpo de `SKILL.md` |
| 3. Recursos | Bajo demanda | 0 hasta que se usan | Archivos de referencia (se leen), scripts (se ejecutan; solo su salida entra en contexto) |

Fuentes: F1, F4. En Claude Code, una vez cargado el `SKILL.md` permanece en contexto
durante la conversación (coste recurrente) y tras una compactación solo se conservan los
primeros 5000 tokens de cada skill (F3).

## 5. Instalación y distribución

### Claude Code (F3)

| Ámbito | Ruta |
|--------|------|
| Personal | `~/.claude/skills/<nombre>/SKILL.md` (todos tus proyectos en esa máquina; F3 indica que no se carga en sesiones Cowork/cloud) |
| Proyecto | `.claude/skills/<nombre>/SKILL.md` (se comparte haciendo commit) |
| Anidado | `<subcarpeta>/.claude/skills/<nombre>/SKILL.md` |
| Plugin | `<plugin>/skills/<nombre>/SKILL.md` |
| Sincronizadas desde claude.ai | `~/.claude/skills/synced/` (reservado, no usar) |

Claude Code detecta cambios en esas carpetas sin reiniciar; `/reload-skills` para
carpetas nuevas no vigiladas. `/skills` lista las skills disponibles.

### claude.ai (F1, F5)

- Se sube un **archivo ZIP** desde *Customize > Skills* (F5; F1 dice *Settings >
  Features*). Requiere tener activada la ejecución de código.
- El ZIP debe contener **la carpeta de la skill como raíz**: `mi-skill.zip → mi-skill/SKILL.md`.
- Las skills subidas a claude.ai son individuales por usuario y **no se sincronizan** con
  la API ni con Claude Code (F1).
- No documentado: tamaño máximo del ZIP, extensiones admitidas, si se aceptan archivos
  ocultos. Decisión: el empaquetador excluye cachés, archivos ocultos y `tests/`.

### Entorno de ejecución por superficie (F1)

- claude.ai: acceso a red variable según configuración.
- API: sin red y sin instalación de paquetes en tiempo de ejecución.
- Claude Code: acceso a red completo; evitar instalar paquetes globales.

## 6. Buenas prácticas oficiales (F2, F3, F4)

- **Concisión:** Claude ya es muy capaz; añade solo lo que no sabe.
- `SKILL.md` **por debajo de 500 líneas**; si se acerca, dividir en archivos de referencia.
- Referencias **a un solo nivel** de profundidad desde `SKILL.md` (no encadenar).
- Archivos de referencia de **más de 100 líneas** → tabla de contenidos al principio.
- Indicar **cuándo leer** cada archivo de referencia y si un script se **ejecuta** o se **lee**.
- Nombres: preferible gerundio (`processing-pdfs`); evitar nombres vagos (`helper`,
  `utils`, `tools`, `documents`, `data`, `files`).
- Descripción en **tercera persona**, específica, con palabras clave.
- Grado de libertad adecuado: texto para tareas flexibles, scripts exactos para
  operaciones frágiles.
- Flujos complejos: pasos numerados y checklist; bucles validar → corregir → repetir.
- Evitar información con fecha de caducidad, terminología inconsistente, demasiadas
  opciones y rutas con barra invertida (`\`).
- Scripts: resolver los errores en lugar de delegarlos en Claude, sin "constantes
  mágicas", dependencias declaradas, mensajes de error útiles.
- Herramientas MCP: nombre completo `Servidor:herramienta`.
- Probar con al menos tres evaluaciones y con los modelos en los que se vaya a usar.
- Seguridad: usar skills solo de fuentes de confianza; auditar scripts y llamadas de red.

## 7. Cómo detectar si una skill se ha usado (pruebas automáticas)

No hay una herramienta oficial de pruebas de activación (F2: "There is not currently a
built-in way to run these evaluations"). Método empleado, basado en F3 y en el script
`run_eval.py` de F7, y **comprobado en este entorno** con Claude Code 2.1.292:

1. Ejecutar `claude -p "<petición>" --output-format stream-json --verbose` en una carpeta
   temporal que contenga la skill en `.claude/skills/<nombre>/`.
2. El evento `system`/`init` incluye la lista `skills`: si la skill no aparece, la
   detección no es fiable.
3. La skill se ha usado si aparece un bloque `tool_use` con `name == "Skill"` y
   `input.skill == "<nombre>"` (o una lectura de su `SKILL.md`).

## 8. Puntos no documentados o ambiguos

- Tamaño máximo del ZIP para claude.ai y lista de archivos admitidos.
- Límite real de la descripción en claude.ai (200 según F5 frente a 1024 según F1/F4).
- Si claude.ai acepta los campos propios de Claude Code en el frontmatter.
- Comportamiento de `${CLAUDE_SKILL_DIR}` fuera de Claude Code (solo documentado en F3).
- Formato de las pruebas de activación: no hay estándar; `tests/activacion.json` es un
  formato propio de este proyecto.
