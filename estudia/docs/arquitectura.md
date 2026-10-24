# Arquitectura de Estudia

```
Navegador (React + Vite + Tailwind + Motion)          Netlify Functions (servidor)              Servicios
─────────────────────────────────────────────         ─────────────────────────────            ─────────────
Páginas y componentes ──supabase-js (clave anon)──▶   ·                                          Supabase
   │  lecturas/escrituras directas protegidas por RLS ───────────────────────────────────────▶  Postgres + pgvector
   │                                                                                             Auth · Storage
   └─ /api/trabajos ─────────────────────────────▶  trabajos.ts (auth, consentimiento,
                                                     límites, crea ai_jobs) ──▶ *-background.ts ──▶ API de Claude
                                                                                (hasta 15 min)       (visión, texto)
      /api/plan ─────────────────────────────────▶  plan-estudio.ts (sin IA)                       Voyage (opcional)
      /api/consentimiento ───────────────────────▶  consentimiento.ts (tutores)                    Resend (opcional)
      /api/privacidad ───────────────────────────▶  privacidad.ts (exportar / borrar)
```

## Principios
- **Claves solo en el servidor.** El navegador usa la clave pública *anon* de Supabase; todo lo demás (service role, Anthropic, Voyage, Resend) vive en variables de entorno de Netlify.
- **RLS en todas las tablas.** El navegador lee y escribe directamente en Supabase, pero cada fila tiene `user_id` y las políticas solo dejan tocar lo propio. Las funciones usan *service role* y filtran siempre por usuario.
- **Consentimiento en la base de datos.** `puede_tratar_datos()` bloquea en RLS y en Storage la subida de apuntes sin consentimiento vigente (menores de 14 sin permiso del tutor).
- **IA en segundo plano.** Leer fotos o generar un examen puede tardar más que el límite de una función normal, así que `/api/trabajos` crea una fila en `ai_jobs` y lanza una *background function* (hasta 15 min). La web consulta el progreso cada 1,5 s.

## Flujo de los apuntes
1. **Subida** (`SubidaFotos`): la foto se mejora en el navegador (`src/lib/imagen.ts`: recorte de la hoja, enderezado por perfil de proyección, estiramiento de contraste, aviso si parece borrosa) y se sube a Storage `apuntes/{user_id}/{exam_id}/…`.
2. **Lectura** (`leer-apuntes-background`): Claude con visión transcribe a Markdown + LaTeX con salida estructurada. Lo dudoso va marcado `[[?…?]]` y listado en `dudas`; si no se puede leer, `legible=false` con un aviso.
3. **Revisión** (`VisorFotoTexto`): foto y texto lado a lado; no se puede confirmar con dudas pendientes.
4. **Organización e indexado** (`organizar-temas-background`): asigna temas (IA), divide en fragmentos (`src/lib/fragmentar.ts`) con su origen («Foto 3 · p. 2»), calcula embeddings (Voyage, opcional) y guarda en `chunks` (pgvector + texto completo en español). Marca como desactualizado lo generado, recalcula el plan y vuelve a generar automáticamente resúmenes, esquemas y flashcards de los temas afectados si quedan usos de IA.

## Fidelidad: nada inventado
- Los fragmentos se envían a Claude como `<fragmento ref="F3" origen="Foto 2">`.
- Cada elemento devuelto debe citar referencias en `fuentes`. `src/lib/citas.ts` (`validarCitas`) **descarta** lo que no cite un fragmento real; solo se conserva sin cita lo marcado `ampliacion: true`, que la interfaz muestra como «⚠️ Ampliación · compruébalo».
- En flashcards y exámenes de práctica no se admiten ampliaciones.
- Si se descarta más del 30 % de lo generado, se repite la petición una vez con un aviso más estricto.
- `scripts/prueba-lectura.ts` mide además el «apoyo léxico» de cada elemento frente a sus fragmentos citados para revisar a mano lo sospechoso.

## Búsqueda (RAG)
`buscar_fragmentos()` combina texto completo (`tsvector` en español, consulta OR) y similitud vectorial (`<=>`, índice HNSW) con *Reciprocal Rank Fusion*. Sin `VOYAGE_API_KEY` funciona solo con texto completo. Se usa en el tutor y en la corrección; los resúmenes, esquemas, flashcards y tests usan todos los fragmentos del tema (con muestreo uniforme si superan ~180.000 caracteres).

## IA
- Modelo configurable (`ANTHROPIC_MODEL`, por defecto `claude-opus-5-5`), streaming, pensamiento adaptativo, esfuerzo por tarea (alto para leer y corregir, medio para generar) y salidas estructuradas validadas con Zod.
- Reintento automático en otro modelo si el principal rechaza la petición (`fallbacks: "default"`).
- Caché de los prompts del sistema (estables).
- `ai_usage` registra tokens por llamada; los límites diarios por tipo (lectura, generación, corrección, tutor) y de tokens se configuran por variables de entorno. Un trabajo fallido no consume el límite.

## Lógica sin IA (probada con tests)
| Archivo | Qué hace |
|---|---|
| `src/lib/fsrs.ts` | FSRS-5: estabilidad, dificultad, recuperabilidad; ajuste a la fecha del examen; cola del día |
| `src/lib/plan.ts` | Plan día a día, viabilidad de la nota y reajuste |
| `src/lib/progreso.ts` | Dominio por tema, nota estimada orientativa, recomendaciones, racha |
| `src/lib/corregir.ts` | Corrección instantánea de preguntas cerradas |
| `src/lib/simulacro.ts` | Composición del examen de práctica según el formato real |
| `src/lib/citas.ts` | Validación de citas |

## Datos
Ver `supabase/migrations`. Tablas pedidas: `profiles`, `exams`, `exam_topics`, `uploads`, `extracted_texts`, `chunks`, `summaries`, `mindmaps`, `flashcards`, `reviews`, `quizzes`, `quiz_attempts`, `mock_exams`, `mock_exam_attempts`, `study_plans`, `study_sessions`, `streaks`, `achievements`, `ai_usage`. Además, por necesidad técnica: `ai_jobs` (progreso de las tareas en segundo plano), `tutor_messages` (historial del tutor) y `feynman_attempts` (resultados de la técnica Feynman).
Las rachas y logros los calculan disparadores en la base de datos al registrar sesiones (el usuario no puede escribirlos).
