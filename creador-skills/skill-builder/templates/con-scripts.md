---
name: {{nombre-en-gerundio}}
description: {{Qué procesa y qué produce}}. Usar cuando el usuario comparta o mencione {{tipo de archivo/extensión}} o pida {{verbos reales}}.
compatibility: Requiere Python 3.10 o superior (solo biblioteca estándar).
---

# {{Título legible}}

<!-- PLANTILLA 2 · Skill con scripts (p. ej. procesar archivos).
     Los scripts van en scripts/, son deterministas, gestionan errores y no contienen claves.
     Indica siempre el comando exacto y si Claude debe EJECUTAR o LEER el script. -->

## Objetivo

{{Qué transforma la skill y qué entrega.}}

## Cuándo usarla

- {{El usuario adjunta o menciona un archivo .ext}}
- {{El usuario pide «…»}}

## Flujo de trabajo

1. Comprueba que el archivo existe y tiene extensión {{.ext}}. Si no, pide la ruta correcta.
2. Ejecuta el script (no lo leas; solo importa su salida):
   ```bash
   python3 scripts/{{script}}.py RUTA_ENTRADA [opciones]
   ```
3. Si el script termina con código distinto de 0, lee el mensaje de error, corrige la
   causa (ruta, codificación, formato) y vuelve a ejecutarlo. No intentes reproducir el
   cálculo a mano.
4. Presenta la salida con el formato indicado y añade {{interpretación breve}}.

## Script disponible

| Script | Qué hace | Salida |
|--------|----------|--------|
| `scripts/{{script}}.py` | {{descripción}} | {{formato}} |

Opciones: {{--opcion: efecto}}.

## Formato de salida

```
{{Plantilla del resultado}}
```

## Casos límite y errores

- Archivo vacío: {{qué hacer}}.
- Codificación desconocida: el script prueba UTF-8 y Latin-1; si falla, pide al usuario el archivo en UTF-8.
- Archivo muy grande: {{límite y alternativa}}.

## Ejemplo

**Entrada:** «{{petición}}» con `{{archivo}}`
**Comando:** `python3 scripts/{{script}}.py {{archivo}}`
**Salida:** {{resumen de lo que se entrega}}
