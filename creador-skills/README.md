# Creador de skills para Claude

Herramienta para diseñar, escribir, validar, probar, empaquetar e instalar **Agent
Skills** de calidad profesional para **Claude Code** y **claude.ai**. Funciona de dos formas:

1. Como **skill instalada en Claude Code** (`skill-builder`): basta con decir
   «crea una skill que haga X».
2. Como **scripts de apoyo** en Python 3.10+ sin dependencias: `validate.py`,
   `test_triggers.py`, `package.py` e `install.py`.

```
creador-skills/
├── skill-builder/              ← la skill creadora
│   ├── SKILL.md
│   ├── scripts/                ← validate.py, test_triggers.py, package.py, install.py
│   ├── templates/              ← 4 plantillas de SKILL.md
│   ├── reference/              ← especificación resumida, buenas prácticas, pruebas
│   └── tests/activacion.json
├── docs/especificacion-skills.md  ← especificación oficial resumida, con fuentes y fecha
├── examples/                   ← 3 skills de ejemplo completas
│   ├── redactando-correos-formales/   (solo instrucciones)
│   ├── resumiendo-csv/                (con script)
│   └── aplicando-marca-lumen/         (con archivos de referencia)
├── dist/                       ← paquetes .zip listos para claude.ai
└── pruebas/test_scripts.py     ← pruebas automáticas de los scripts
```

## Qué es una skill y cómo funciona

Una skill es una carpeta con un archivo `SKILL.md` (frontmatter YAML + instrucciones en
Markdown) y, opcionalmente, scripts, archivos de referencia y recursos. Claude la usa
automáticamente cuando tu petición encaja con su descripción.

- **Frontmatter obligatorio:** `name` (máx. 64 caracteres; minúsculas, números y guiones;
  sin «claude» ni «anthropic»; igual que la carpeta) y `description` (máx. 1024
  caracteres; qué hace y cuándo usarla; sin `<` ni `>`).
- **Carga progresiva:** Claude ve siempre solo `name` + `description` (~100 tokens);
  lee el cuerpo de `SKILL.md` al activarla (recomendado < 500 líneas) y abre los demás
  archivos solo si los necesita. Los scripts se ejecutan sin cargar su código.
- **La descripción decide la activación:** debe incluir las palabras que usarías al pedirlo.

Resumen completo, discrepancias entre fuentes y decisiones conservadoras:
[docs/especificacion-skills.md](docs/especificacion-skills.md). Fuentes oficiales:
- [Agent Skills – visión general](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Buenas prácticas de autoría](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Skills en Claude Code](https://code.claude.com/docs/en/skills)
- [Especificación abierta](https://agentskills.io/specification)
- [Crear skills en claude.ai](https://support.claude.com/en/articles/12512198-creating-custom-skills)
- [Repositorio oficial de skills](https://github.com/anthropics/skills)

## Instalar el creador

Requisitos: Python 3.10 o superior (`python3 --version`). La CLI de Claude Code
(`claude`) es opcional: sin ella las pruebas de activación son manuales.

```bash
cd creador-skills
python3 skill-builder/scripts/install.py skill-builder --ambito personal
```

Queda en `~/.claude/skills/skill-builder/`. Compruébalo en Claude Code con `/skills`.

## Usar el creador desde Claude Code

Escribe en Claude Code, por ejemplo:

> Crea una skill que convierta mis notas de reunión en un acta con decisiones y tareas.

o invócalo directamente con `/skill-builder …`. El flujo es siempre:

1. **Entrevista breve** (máximo 5 preguntas, ninguna si ya lo has explicado).
2. **Diseño**: nombre, descripción, estructura y pruebas de activación. **Espera tu confirmación.**
3. **Escritura** a partir de la plantilla adecuada, en `./skills/<nombre>/`.
4. **Validación** (`validate.py`) y **pruebas de activación** (`test_triggers.py`).
5. **Entrega**: instalación en Claude Code y/o `.zip` para claude.ai, con un resumen final.

También sirve para skills existentes: «valida mi skill de ./skills/x», «empaqueta…», «mi skill no se activa…».

## Scripts

Todos están en `skill-builder/scripts/`, usan solo la biblioteca estándar y muestran
mensajes en español con archivo, línea y cómo solucionarlo. `--help` muestra todas las opciones.

### validate.py

```bash
python3 skill-builder/scripts/validate.py RUTA_SKILL [--destino ambos|claude-code|claudeai] [--estricto]
```

Errores (❌, bloqueantes) y avisos (⚠️, mejorables). Comprueba:
- `SKILL.md` existe (detecta `skill.md` en minúsculas) y el frontmatter YAML es válido
  (valores con `: ` sin comillas, comillas sin cerrar, tabuladores, claves duplicadas…).
- `name`: longitud, caracteres, guiones, palabras reservadas, coincide con la carpeta.
- `description`: longitud (1024; aviso a partir de 200 por el límite del centro de ayuda
  de claude.ai, error con `--estricto`), sin `<` `>`, indica cuándo usarla, tercera persona.
- Campos desconocidos y campos exclusivos de Claude Code según `--destino`.
- Longitud del cuerpo (500 líneas / ~5000 tokens) con sugerencia de mover contenido a `reference/`.
- Archivos enlazados o ejecutados desde `SKILL.md` existen y están dentro de la skill;
  referencias anidadas; tablas de contenidos en referencias de más de 100 líneas.
- Claves, tokens y contraseñas en cualquier archivo (Anthropic, AWS, GitHub, Slack,
  Google, Stripe, claves privadas, JWT, credenciales en URL, asignaciones `password = "…"`).
  Para una línea de ejemplo legítima, añade el comentario `validate: ignorar-secreto`.
- Sintaxis de scripts `.py` (y `.sh`/`.js` si hay `bash`/`node`).
- Un único `SKILL.md` por skill.

Salida: 0 válida · 1 con errores · 2 uso incorrecto.

### test_triggers.py

```bash
python3 skill-builder/scripts/test_triggers.py RUTA_SKILL [--paralelo 3] [--repeticiones 1] [--modelo M] [--manual]
```

Si existe la CLI `claude`, copia la skill a una carpeta temporal
(`.claude/skills/<nombre>/`), ejecuta cada petición con
`claude -p … --output-format stream-json --verbose` y comprueba si Claude invoca la
herramienta `Skill` con esa skill. Informa de aciertos, fallos y sugerencias para la
descripción. Si no hay CLI o la detección no es fiable, genera
`tests/checklist-activacion.md` para probar a mano. Cada petición consume uso de tu cuenta.

Salida: 0 todo correcto · 1 fallos · 2 uso incorrecto · 3 checklist manual.

### package.py

```bash
python3 skill-builder/scripts/package.py RUTA_SKILL [--salida dist] [--incluir-tests] [--estricto]
```

Valida para claude.ai y, si no hay errores, crea `dist/<nombre>.zip` con la carpeta de la
skill como raíz. Excluye cachés, archivos ocultos (`.env`, `.git`…), temporales y
`tests/`. El ZIP es reproducible y se verifica tras crearlo.

### install.py

```bash
python3 skill-builder/scripts/install.py RUTA_SKILL --ambito personal
python3 skill-builder/scripts/install.py RUTA_SKILL --ambito proyecto [--proyecto RUTA]
```

Copia la skill a `~/.claude/skills/<nombre>/` o a `<proyecto>/.claude/skills/<nombre>/`.
Si ya existe, pide confirmación (o `--si`) y guarda antes una copia con fecha en
`~/.claude/skill-backups/<nombre>-AAAAMMDD-HHMMSS/` (o la equivalente del proyecto),
fuera de `skills/` para que Claude Code no la cargue como skill duplicada.

### Pruebas de los propios scripts

```bash
python3 -m unittest pruebas/test_scripts.py -v
```

Incluyen los casos que deben fallar: frontmatter roto, nombre inválido, descripción
demasiado larga, enlace a archivo inexistente, claves expuestas, scripts con errores,
paquetes inválidos y reinstalación sin confirmación.

## Escribir tests/activacion.json

```json
{
  "casos": [
    {"peticion": "Resúmeme el archivo ventas.csv", "debe_activarse": true},
    {"peticion": "Hazme un gráfico con estas ventas", "debe_activarse": false,
     "nota": "gráficos: fuera de alcance"}
  ]
}
```

- 8–12 casos, mitad que deben activarla y mitad que no.
- Peticiones realistas, como las escribirías tú, con detalles concretos.
- Los negativos más útiles son los **cercanos**: mismo tema, otra tarea.

Más detalles en [skill-builder/reference/pruebas-activacion.md](skill-builder/reference/pruebas-activacion.md).

## Subir una skill a claude.ai

1. `python3 skill-builder/scripts/package.py RUTA_SKILL` → `dist/<nombre>.zip`.
2. En claude.ai: **Customize > Skills** (en algunas versiones, *Settings > Features*) → añadir/subir el ZIP.
3. Requiere tener activada la ejecución de código. Las skills subidas son personales y no
   se sincronizan con Claude Code ni con la API.

Los paquetes de este proyecto ya están en [dist/](dist/).

## Instalar una skill en Claude Code

- Personal (todos tus proyectos): `install.py RUTA --ambito personal`.
- Proyecto (se comparte haciendo commit de `.claude/skills/`): `install.py RUTA --ambito proyecto`.

Claude Code detecta los cambios sin reiniciar (`/reload-skills` si la carpeta es nueva).
Compruébalo con `/skills` o invoca la skill con `/<nombre>`.

## Limitaciones conocidas

- Las pruebas de activación usan un modelo de lenguaje: los resultados pueden variar
  entre ejecuciones (usa `--repeticiones`). La decisión se toma con la primera
  herramienta que usa Claude.
- `test_triggers.py` también ve las demás skills instaladas; una skill parecida puede
  «robar» la activación.
- El analizador YAML del validador cubre el subconjunto habitual en frontmatter (no
  anclas, etiquetas ni colecciones de flujo anidadas); ante algo no soportado da error claro.
- La detección de secretos es por patrones: no sustituye a una revisión manual.
- El límite real de la descripción en claude.ai no es coherente entre fuentes (200 frente
  a 1024); por eso es aviso y no error salvo con `--estricto`.
