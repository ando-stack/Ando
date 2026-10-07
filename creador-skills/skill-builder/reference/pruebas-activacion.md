# Pruebas de activación (tests/activacion.json)

## Formato

```json
{
  "casos": [
    {"peticion": "Resúmeme este ventas.csv", "debe_activarse": true},
    {"peticion": "¿Qué es un archivo CSV?", "debe_activarse": false,
     "nota": "pregunta general, no hay datos que procesar"}
  ]
}
```

- `peticion` (obligatorio): el texto exacto que escribiría el usuario.
- `debe_activarse` (obligatorio): `true` o `false`.
- `nota` (opcional): por qué se espera ese resultado.

## Cómo elegir los casos

- Entre 8 y 12 casos: aproximadamente la mitad deben activarse y la otra mitad no.
- Positivos variados: petición explícita, petición coloquial, petición que no nombra la
  skill pero encaja, petición en otro idioma si el usuario lo usaría.
- Negativos **cercanos** (lo más útil): misma temática pero otra tarea, o tarea parecida
  con otro tipo de archivo. Evita negativos obvios («¿qué hora es?»): no enseñan nada.
- Usa peticiones realistas, con detalles concretos (nombres de archivo, contexto), no
  frases abstractas.

## Ejecutar

```bash
python3 scripts/test_triggers.py RUTA_SKILL            # automático si existe la CLI `claude`
python3 scripts/test_triggers.py RUTA_SKILL --manual   # solo checklist manual
python3 scripts/test_triggers.py RUTA_SKILL --repeticiones 3   # reduce el ruido
```

Códigos de salida: 0 todo correcto · 1 hay fallos · 2 uso incorrecto · 3 checklist manual.

## Interpretar resultados

- **No se activa cuando debe** (lo más habitual): añade a la descripción las palabras de
  esas peticiones y una frase «Usar cuando…»; hazla algo más insistente.
- **Se activa cuando no debe**: concreta el alcance (tipo de archivo, resultado) y añade
  «No usar para…».
- **Indeterminado**: la CLI no respondió a tiempo, dio error o no cargó la skill. Repite
  o prueba a mano.
- Las peticiones muy simples («lee este archivo») pueden no activar ninguna skill porque
  Claude las resuelve directamente; no es necesariamente un fallo de la descripción.
- Tras cambiar la descripción, vuelve a validar y a probar. Máximo 3 iteraciones; si no
  converge, comenta los casos dudosos con el usuario.
