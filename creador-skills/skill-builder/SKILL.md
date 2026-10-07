---
name: skill-builder
description: Crea, mejora, valida, prueba y empaqueta skills (SKILL.md). Usar cuando el usuario pida crear una skill, convertir un proceso en skill, arreglar su descripción o activación, validarla o instalarla.
license: MIT
metadata:
  version: "1.0"
---

# Creador de skills

## Objetivo

Convertir lo que describe el usuario en una skill profesional, válida según la
especificación oficial, probada y lista para Claude Code y/o claude.ai.

## Cuándo usarla

- El usuario pide crear una skill, o convertir en skill un proceso, unas instrucciones o una guía.
- El usuario quiere revisar, validar, probar, empaquetar o instalar una skill existente
  (salta directamente al paso correspondiente del flujo).

No la uses para crear subagentes, hooks, comandos sin SKILL.md ni servidores MCP.

## Rutas

Los scripts están en la carpeta de esta skill. En Claude Code esa carpeta es
`${CLAUDE_SKILL_DIR}`; en otros entornos, la carpeta donde está este SKILL.md. Crea las
skills nuevas en `./skills/NOMBRE/` del directorio de trabajo, salvo que el usuario
indique otra ruta.

## Flujo de trabajo

Copia este checklist en tu respuesta y márcalo a medida que avances:

```
Creación de skill:
- [ ] 1. Entrevista breve
- [ ] 2. Diseño  ⏸ esperar confirmación
- [ ] 3. Escritura
- [ ] 4. Validación y pruebas
- [ ] 5. Entrega ⏸ confirmar destino
```

### 1. Entrevista breve

Extrae primero todo lo posible de la conversación. Después pregunta **solo lo que falte**,
en un único mensaje y con **5 preguntas como máximo** (ninguna si ya está claro):

1. Qué debe hacer la skill y qué resultado debe producir.
2. En qué situaciones debe activarse y en cuáles no.
3. Si necesita archivos de entrada, scripts o recursos (plantillas, guías de estilo, datos).
4. Dónde se usará: Claude Code, claude.ai o ambos.
5. Dos o tres peticiones reales con las que la usaría.

Supuestos por defecto si el usuario no responde: idioma español, destino «ambos»,
instalación personal en Claude Code.

### 2. Diseño ⏸

Lee [reference/buenas-practicas.md](reference/buenas-practicas.md) y elige la plantilla:

| Tipo de skill | Plantilla |
|---------------|-----------|
| Solo instrucciones (guía de estilo, criterios de revisión) | [templates/instrucciones.md](templates/instrucciones.md) |
| Con scripts (procesar archivos, cálculos, conversiones) | [templates/con-scripts.md](templates/con-scripts.md) |
| Con archivos de referencia (marca, API, normativa) | [templates/con-referencias.md](templates/con-referencias.md) |
| Flujo en varios pasos con confirmaciones | [templates/flujo-varios-pasos.md](templates/flujo-varios-pasos.md) |

Presenta el diseño con este formato y **detente hasta que el usuario lo confirme o pida cambios**:

```
**Nombre:** nombre-en-gerundio
**Descripción (N caracteres):** …
**Plantilla:** …
**Estructura:**
nombre/
├── SKILL.md            → objetivo, flujo, reglas, formato, ejemplos
├── reference/<tema>.md   → (qué contiene y cuándo se lee)
├── scripts/<script>.py   → (qué hace)
└── tests/activacion.json
**Pruebas de activación:** N que deben activarla / M que no (lista)
```

Reglas de diseño (detalles en [reference/especificacion.md](reference/especificacion.md)):
- `name`: 1–64 caracteres, solo `a-z0-9-`, sin «claude» ni «anthropic», igual a la carpeta.
- `description`: qué hace + cuándo usarla, tercera persona, con las palabras del usuario,
  sin `<` ni `>`. Máximo 1024; si se subirá a claude.ai, procura no pasar de 200.
- Cuerpo de SKILL.md < 500 líneas: lo extenso va a `reference/`; lo determinista, a `scripts/`.
- Campos exclusivos de Claude Code solo si el destino es únicamente Claude Code.

### 3. Escritura

1. Crea la carpeta y el SKILL.md a partir de la plantilla; sustituye todos los `{{…}}` y
   borra los comentarios de la plantilla.
2. Cuerpo: objetivo, cuándo usarla, pasos en orden, formato de salida, reglas, casos
   límite y errores, y al menos un ejemplo entrada → salida. Imperativo, sin relleno.
3. Scripts (si hacen falta): Python 3.10+ con biblioteca estándar, deterministas, con
   errores claros en el idioma de la skill y códigos de salida. Nunca claves ni datos
   sensibles: usa variables de entorno. Documenta en SKILL.md el comando exacto.
   Prueba cada script con un caso real y con un caso de error antes de seguir.
4. Referencias (si hacen falta): enlázalas desde SKILL.md indicando cuándo leer cada una.
5. Escribe `tests/activacion.json` con 8–12 casos según
   [reference/pruebas-activacion.md](reference/pruebas-activacion.md).
6. Idioma: el que pida el usuario (español por defecto).

### 4. Validación y pruebas

Ejecuta, corrige y repite hasta que no haya errores:

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/validate.py skills/NOMBRE --destino ambos
```

- `--destino claude-code` o `--destino claudeai` si solo se usará en uno.
- Corrige todos los errores (❌). Corrige los avisos (⚠️) salvo que haya un motivo; si
  dejas alguno, explícalo en la entrega.

Después prueba la activación:

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/test_triggers.py skills/NOMBRE
```

- Si hay fallos, ajusta la descripción según las sugerencias del informe, vuelve a
  validar y repite (máximo 3 iteraciones).
- Código 3 = no hay CLI o la detección no es fiable: entrega el checklist manual que el
  script genera dentro de la carpeta tests de la skill creada.
- Cada petición consume uso de la cuenta: avisa antes si hay más de 15 casos.

### 5. Entrega ⏸

Confirma con el usuario el destino y ejecuta lo que corresponda:

```bash
# Claude Code – personal (~/.claude/skills) o proyecto (.claude/skills)
python3 ${CLAUDE_SKILL_DIR}/scripts/install.py skills/NOMBRE --ambito personal
python3 ${CLAUDE_SKILL_DIR}/scripts/install.py skills/NOMBRE --ambito proyecto --proyecto RUTA

# claude.ai – genera dist/NOMBRE.zip (valida antes y no empaqueta si hay errores)
python3 ${CLAUDE_SKILL_DIR}/scripts/package.py skills/NOMBRE --salida dist
```

Si `install.py` informa de que ya existe una skill con ese nombre, pregunta al usuario y
solo entonces repite con `--si` (siempre deja copia de seguridad con fecha).

Termina con este resumen:

```
## Skill «NOMBRE» lista
- **Qué hace:** …
- **Cómo se activa:** descripción + ejemplos de peticiones; manualmente con /NOMBRE (Claude Code)
- **Archivos:** lista con una línea por archivo
- **Validación:** ✅ sin errores (N avisos: …)
- **Pruebas de activación:** X/Y aciertos (o checklist manual en …)
- **Instalación / paquete:** ruta instalada y/o ruta del .zip y cómo subirlo (claude.ai → Customize > Skills)
```

## Reglas

- No escribas archivos antes de que el usuario confirme el diseño.
- No inventes campos, límites ni rutas: si dudas, consulta [reference/especificacion.md](reference/especificacion.md).
- Nunca incluyas claves, tokens, contraseñas ni datos personales en la skill.
- No sobrescribas una skill existente sin confirmación del usuario.
- No añadas funciones que el usuario no haya pedido.

## Casos límite y errores

- **El usuario ya lo ha explicado todo:** no preguntes; pasa al diseño.
- **Petición demasiado amplia** («una skill para todo mi trabajo»): propón dividirla en
  varias skills con una responsabilidad cada una.
- **Ya existe una carpeta con ese nombre:** pregunta si quiere mejorarla o elegir otro nombre.
- **Skill existente para mejorar:** valida primero, muestra el informe y propón cambios.
- **Falta Python 3.10+:** escribe la skill igualmente, revisa manualmente las reglas de
  [reference/especificacion.md](reference/especificacion.md) y avisa de que los scripts no se han ejecutado.
- **El usuario pide algo dañino o engañoso:** no lo crees y explica por qué.

## Ejemplos

**Entrada:** «Crea una skill que convierta mis notas de reunión en un acta con decisiones y tareas.»
**Acción:** como falta poco, pregunta solo destino y 2 peticiones de ejemplo → diseño
`redactando-actas-de-reunion` (plantilla de instrucciones, sin scripts) → tras confirmar,
escribe, valida, prueba e instala.

**Entrada:** «Valida mi skill de ./skills/facturas y súbela a claude.ai.»
**Acción:** salta al paso 4 → `validate.py skills/facturas --destino claudeai` → corrige
→ `package.py skills/facturas` → indica dónde está el .zip y cómo subirlo.
