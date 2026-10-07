# Especificación resumida de Agent Skills

Resumen operativo para crear skills. Fuente completa con enlaces y fecha de consulta:
`docs/especificacion-skills.md` del proyecto creador-skills.

## Contenido
- Estructura mínima
- Frontmatter: campos y límites
- Campos exclusivos de Claude Code
- Carga progresiva
- Dónde se instalan y cómo se suben
- Decisiones conservadoras

## Estructura mínima

```
nombre-skill/            ← la carpeta se llama igual que `name`
├── SKILL.md             ← obligatorio, exactamente uno
├── scripts/             ← opcional: código que Claude ejecuta
├── reference/           ← opcional: documentación que Claude lee bajo demanda
├── assets/              ← opcional: plantillas, imágenes, datos
└── tests/activacion.json  ← pruebas de activación (no se empaqueta)
```

## Frontmatter: campos y límites

| Campo | Oblig. | Reglas |
|-------|--------|--------|
| `name` | Sí | 1–64 caracteres; solo `a-z`, `0-9` y `-`; sin guion inicial/final ni `--`; sin «anthropic» ni «claude»; sin etiquetas XML; igual al nombre de la carpeta. |
| `description` | Sí | 1–1024 caracteres; sin `<` ni `>`; tercera persona; qué hace + cuándo usarla. claude.ai indica 200 como máximo en su centro de ayuda: si se va a subir allí, intenta no pasar de 200. |
| `license` | No | Nombre de licencia o archivo incluido. |
| `compatibility` | No | 1–500 caracteres; requisitos de entorno. |
| `metadata` | No | Mapa texto → texto (p. ej. `version: "1.0"`). |
| `allowed-tools` | No | Herramientas preaprobadas (experimental). |

Valores con `:` seguidos de espacio, o que empiezan por `[ { & * ! | > % @`, van entre comillas.

## Campos exclusivos de Claude Code

`when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`,
`disallowed-tools`, `model`, `effort`, `context`, `agent`, `background`, `hooks`, `paths`,
`shell`. Úsalos solo si la skill es exclusiva de Claude Code (valida con
`--destino claude-code`); el empaquetado para claude.ai los rechaza.
`description` + `when_to_use` ≤ 1536 caracteres. Nombres reservados: `synced`, `anthropic-skills`.

## Carga progresiva

1. **Metadatos** (`name` + `description`, ~100 tokens): siempre cargados. Deciden la activación.
2. **Cuerpo de SKILL.md** (< 500 líneas, < 5000 tokens): se carga al activarse.
3. **Recursos**: se leen o ejecutan solo si SKILL.md lo indica. Los scripts no cuestan
   contexto: solo su salida.

## Dónde se instalan y cómo se suben

- Claude Code personal: `~/.claude/skills/<nombre>/`
- Claude Code proyecto: `<proyecto>/.claude/skills/<nombre>/` (se comparte con commit)
- claude.ai: ZIP con la carpeta como raíz (`nombre.zip → nombre/SKILL.md`), subido en
  *Customize > Skills*. Requiere ejecución de código activada. No se sincroniza con
  Claude Code ni con la API.

## Decisiones conservadoras

- `name` siempre obligatorio y con las reglas estrictas, aunque Claude Code lo trate como opcional.
- Cualquier campo desconocido es error (Claude Code los ignora en silencio: suelen ser erratas).
- Descripción > 200 caracteres: aviso (error con `--estricto`).
- Un solo SKILL.md por skill; las plantillas internas no se llaman SKILL.md.
