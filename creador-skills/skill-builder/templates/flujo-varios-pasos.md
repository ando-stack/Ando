---
name: {{nombre-en-gerundio}}
description: {{Guía un proceso de N pasos para lograr X}}. Usar cuando el usuario quiera {{objetivo}} o pida {{palabras reales}}.
---

# {{Título legible}}

<!-- PLANTILLA 4 · Flujo de trabajo en varios pasos con puntos de confirmación.
     Marca con ⏸ los puntos donde Claude debe DETENERSE y esperar al usuario. -->

## Objetivo

{{Resultado final del proceso.}}

## Flujo de trabajo

Copia este checklist en tu respuesta y márcalo a medida que avances:

```
Progreso:
- [ ] Paso 1: Recopilar información
- [ ] Paso 2: Proponer plan  ⏸ confirmación
- [ ] Paso 3: Ejecutar
- [ ] Paso 4: Verificar
- [ ] Paso 5: Entregar        ⏸ confirmación
```

### Paso 1 · Recopilar información

Pregunta solo lo que falte (máximo {{N}} preguntas, todas en un único mensaje):
- {{Dato 1}}
- {{Dato 2}}

### Paso 2 · Proponer plan ⏸

Presenta un plan breve con {{elementos}}. **Detente y espera** a que el usuario confirme
o pida cambios. No continúes sin confirmación explícita.

### Paso 3 · Ejecutar

{{Acciones concretas, en orden.}}

### Paso 4 · Verificar

{{Cómo comprobar el resultado.}} Si algo falla, vuelve al paso 3 y corrige; no avances con errores.

### Paso 5 · Entregar ⏸

Muestra el resultado y un resumen. **Pregunta** antes de cualquier acción irreversible
({{publicar, enviar, sobrescribir}}).

## Reglas

- No saltes los puntos de confirmación aunque la petición parezca clara.
- Si el usuario cambia de opinión, vuelve al paso afectado y actualiza el checklist.

## Casos límite

- El usuario no responde a una pregunta: usa {{valor por defecto}} y dilo.
- {{Otro caso}}: {{qué hacer}}.

## Ejemplo

**Entrada:** {{petición}}
**Interacción esperada:** {{preguntas → plan → confirmación → resultado}}
