---
name: resumiendo-csv
description: Resume archivos CSV (filas, columnas, tipos, vacíos y estadísticas) mediante un script. Usar cuando el usuario comparta un .csv o pida analizar, describir o resumir datos tabulares.
license: MIT
compatibility: Requiere Python 3.10 o superior (solo biblioteca estándar).
---

# Resumen de archivos CSV

## Objetivo

Entregar un resumen fiable de un CSV (estructura, calidad de datos y estadísticas) y una
interpretación breve, sin calcular nada a mano.

## Cuándo usarla

- El usuario adjunta o menciona un archivo `.csv` y quiere saber qué contiene.
- Pide «resumir», «describir», «analizar por encima» o «revisar la calidad» de datos tabulares.

No la uses para crear gráficos, limpiar o transformar el CSV ni para archivos Excel (.xlsx).

## Flujo de trabajo

1. Comprueba que el archivo existe y es `.csv` (o texto separado por `;`, tabuladores o `|`).
   Si no tienes la ruta, pídela.
2. Ejecuta el script (no lo leas; solo importa su salida):
   ```bash
   python3 scripts/resumir_csv.py RUTA.csv
   ```
   Opciones: `--separador ";"` si la detección falla; `--max-valores 5` para ver más valores frecuentes.
3. Si termina con código distinto de 0, lee el error y actúa:
   - «no existe el archivo» → pide la ruta correcta.
   - «no se reconoce la codificación» → pide el archivo guardado como CSV UTF-8.
   - «está vacío» / «solo contiene la cabecera» → informa al usuario; no inventes datos.
4. Presenta la salida del script tal cual y añade «Observaciones» (3 puntos como máximo):
   columnas con muchos vacíos, filas irregulares, columnas que parecen identificadores,
   valores extremos llamativos.

## Formato de salida

```
[informe Markdown del script]

### Observaciones
- …
```

## Reglas

- Las cifras salen siempre del script; nunca las recalcules ni las redondees de otra forma.
- No modifiques el archivo original.
- Si el CSV supera ~100 MB, avisa de que puede tardar antes de ejecutar el script.

## Ejemplo

**Entrada:** «¿Qué hay en ventas_2024.csv?»
**Comando:** `python3 scripts/resumir_csv.py ventas_2024.csv`
**Salida (extracto):**
```
# Resumen de `ventas_2024.csv`

- **Filas de datos:** 3
- **Columnas:** 3
- **Separador:** punto y coma · **Codificación:** utf-8

| Columna | Tipo | Vacíos | Únicos | Resumen |
|---|---|---|---|---|
| region | texto | 0 (0 %) | 2 | Norte (2), Sur (1) |
| importe | numérica | 0 (0 %) | 3 | mín 980 · máx 1.250,50 · media 1.110,17 · mediana 1.100 |

### Observaciones
- Datos completos, sin vacíos.
```
