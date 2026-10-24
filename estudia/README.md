# 📚 Estudia — tus apuntes, tu plan

Web de estudio pensada primero para el móvil. El estudiante:

1. **Crea un examen**: asignatura, curso, temas, fecha y hora, nota que quiere sacar, tipo de examen (test, cortas, desarrollo, problemas o mixto con porcentajes), duración, tiempo disponible cada día de la semana y nivel actual.
2. **Sube fotos de sus apuntes** (cámara o galería, varias a la vez), PDF o texto pegado. Las fotos se recortan, enderezan y mejoran solas; la IA las lee (incluidas fórmulas, tablas y esquemas a mano) y el estudiante revisa el texto junto a la foto. Lo que no se lee bien queda marcado para confirmarlo o corregirlo.
3. **Recibe todo el material, basado solo en sus apuntes y citando de qué foto o página sale**:
   - Resumen en tres niveles (ideas clave, resumen, detallado).
   - Esquemas y mapas conceptuales interactivos, exportables a imagen y PDF.
   - Flashcards editables con repetición espaciada **FSRS‑5** adaptada a la fecha del examen.
   - Tests (opción múltiple, verdadero/falso con justificación, respuesta corta, relacionar, ordenar) con corrección explicada al instante.
   - Exámenes de práctica con el formato y la duración reales, temporizador y corrección con rúbrica visible y nota.
   - Técnica Feynman (escrita o dictada) y un tutor por examen con niveles de explicación.
   - **Plan de estudio día a día** que avisa con tacto si la nota no parece alcanzable y se reajusta solo.
   - Panel de progreso (mapa de calor por tema, evolución de notas, nota estimada frente a la objetivo), rachas con día de descanso, logros, calendario con todos los exámenes, Pomodoro y recordatorios opcionales (nunca de noche).

Fundamentos pedagógicos: [`docs/pedagogia.md`](docs/pedagogia.md) · Cumplimiento legal: [`docs/legal.md`](docs/legal.md) · Arquitectura: [`docs/arquitectura.md`](docs/arquitectura.md)

> Esta web está en la carpeta `estudia/` del repositorio (la raíz contiene otro proyecto). Todos los comandos se ejecutan desde `estudia/`.

---

## Requisitos

- **Node.js 18.18 o superior** (probado con Node 22) y npm.
- Una cuenta de **Supabase** (gratuita sirve para empezar).
- Una clave de la **API de Anthropic** (Claude).
- Una cuenta de **Netlify** para desplegar.
- La **CLI de Netlify** viene como dependencia de desarrollo (`npx netlify …`). Si la prefieres global: `npm install -g netlify-cli`.
- Opcional: clave de **Voyage AI** (búsqueda semántica con pgvector) y de **Resend** (correo al tutor).

## Instalación

```bash
cd estudia
npm install
cp .env.example .env      # y rellénalo (ver abajo)
```

`.env` está en `.gitignore`: **nunca subas claves al repositorio**. Solo las variables que empiezan por `VITE_` llegan al navegador, y únicamente deben ser la URL y la clave *anon* (pública) de Supabase.

## Configurar Supabase

1. Crea un proyecto (elige **región de la UE**, por ejemplo Frankfurt, por el RGPD).
2. **Extensión pgvector**: *Database → Extensions → vector → Enable* (la primera migración también intenta activarla).
3. **Aplica las migraciones** de `supabase/migrations/` en orden:
   - Con la CLI de Supabase: `supabase link --project-ref TU_REF && supabase db push`, o
   - Copiando el contenido de cada archivo en *SQL Editor* y ejecutándolo.
   Crean las tablas, las políticas **RLS**, los disparadores (perfil al registrarse, rachas y logros), la búsqueda híbrida y el bucket de **Storage** privado `apuntes` con sus políticas.
4. **Auth**: *Authentication → Providers → Email* activado. Recomendado: *Confirm email* activado. En *URL Configuration* pon tu dominio como *Site URL* y añade `http://localhost:8888` y tu dominio a *Redirect URLs*.
5. Copia en `.env`:
   - `VITE_SUPABASE_URL` y `SUPABASE_URL` → *Project Settings → API → Project URL*.
   - `VITE_SUPABASE_ANON_KEY` → clave `anon` (pública).
   - `SUPABASE_SERVICE_ROLE_KEY` → clave `service_role` (**secreta**, solo servidor).

## Clave de IA y límites de uso

- `ANTHROPIC_API_KEY`: clave de la consola de Anthropic. Solo la usan las funciones de servidor.
- `ANTHROPIC_MODEL`: por defecto `claude-opus-5-5`.
- `INTERNAL_SECRET`: cadena larga aleatoria (p. ej. `openssl rand -hex 32`); protege las funciones en segundo plano.
- **Límites diarios por usuario** (se renuevan cada día, hora de Madrid):

| Variable | Por defecto | Qué limita |
|---|---|---|
| `AI_LIMITE_LECTURAS_DIA` | 40 | Fotos/PDF leídos |
| `AI_LIMITE_GENERACIONES_DIA` | 30 | Resúmenes, esquemas, flashcards, tests y exámenes de práctica |
| `AI_LIMITE_CORRECCIONES_DIA` | 20 | Correcciones de exámenes de práctica y análisis Feynman |
| `AI_LIMITE_TUTOR_DIA` | 60 | Preguntas al tutor |
| `AI_LIMITE_TOKENS_DIA` | 1.500.000 | Tokens totales (entrada + salida) |

El consumo de cada llamada queda en la tabla `ai_usage`, y el estudiante ve su uso del día en el perfil. Al llegar al límite se le explica y puede seguir usando todo lo ya generado. Un trabajo que falla no cuenta.

- Opcionales: `VOYAGE_API_KEY` (embeddings de 1024 dimensiones para pgvector; sin ella se usa búsqueda de texto completo), `RESEND_API_KEY` + `EMAIL_FROM` (correo de consentimiento; sin ella el enlace solo aparece en los registros del servidor, útil en desarrollo) y `PUBLIC_SITE_URL` (dominio para los enlaces del correo).

## Desarrollo local

```bash
npm run dev:netlify      # web + funciones en http://localhost:8888 (recomendado)
npm run dev              # solo la web (Vite, sin /api) en http://localhost:5173
```

Pruebas:

```bash
npm test                 # tests unitarios (FSRS, plan, progreso, corrección, citas, mejora de fotos, validadores)
npm run test:db          # migraciones + RLS en un PostgreSQL local con pgvector (requiere PostgreSQL 15+)
npm run test:e2e         # todas las pantallas en móvil con backend simulado; falla si hay errores de consola (requiere Playwright)
npm run build            # comprobación de tipos + build de producción
```

### Probar la lectura con apuntes reales

```bash
npm run muestras                                     # genera 3 fotos de muestra con su transcripción (.txt)
ANTHROPIC_API_KEY=sk-ant-… npm run prueba:lectura                    # usa scripts/muestras
ANTHROPIC_API_KEY=sk-ant-… npm run prueba:lectura -- ./mis-fotos     # tus fotos (añade un .txt con el mismo nombre para medir el error)
```

Genera `scripts/salida/informe.md` con la tasa de error por caracteres y por palabras, las dudas detectadas, los elementos descartados por no citar los apuntes y los que conviene revisar a mano por tener poco apoyo en el texto. **Prueba con fotos reales de al menos Historia, Matemáticas y Biología** (manuscritas e impresas) antes de publicar.

## Despliegue en Netlify

1. Conecta el repositorio en Netlify (*Add new site → Import an existing project*). El `netlify.toml` de la raíz indica la carpeta base `estudia` y el de `estudia/` el comando `npm run build`, la carpeta `dist` y las funciones. Si Netlify no lo detecta, pon *Base directory* = `estudia` en *Build settings*.
2. En *Site configuration → Environment variables* añade **todas** las variables de `.env.example` (las `VITE_` también, porque se usan al compilar).
3. Despliega. O desde la terminal:
   ```bash
   npx netlify login
   npx netlify init        # o: npx netlify link
   npx netlify deploy --build --prod
   ```
4. Pon la URL final en Supabase (*Site URL* y *Redirect URLs*) y en `PUBLIC_SITE_URL`.

Las tareas largas de IA usan *Background Functions* de Netlify (hasta 15 minutos).

## Cumplimiento legal (resumen)

Detalle y borradores de política de privacidad y términos en [`docs/legal.md`](docs/legal.md) — **deben revisarlos un abogado o DPD antes de publicar**.

- **Menores de 14 años** (art. 7 LOPDGDD, art. 8 RGPD): la cuenta queda pendiente hasta que el padre, madre o tutor da su consentimiento con un enlace de un solo uso enviado a su correo. Hasta entonces no se pueden subir apuntes ni usar la IA (bloqueado también en la base de datos y en Storage).
- **Privacidad por defecto**: apuntes privados, RLS en todas las tablas, bucket privado con URL firmadas, sin publicidad ni rastreadores, fuentes del sistema (sin cargar Google Fonts).
- **Derechos**: exportar todos los datos (JSON + enlaces a los archivos) y borrar la cuenta con todo su contenido desde el perfil.
- **Transparencia IA**: todo lo generado cita su origen; lo que añade la IA se marca como «Ampliación»; la nota estimada se presenta como orientativa.
- Pendiente del responsable: DPA con Supabase, Netlify y Anthropic, EIPD, datos del responsable y registro de actividades.

## Estructura

```
docs/                 pedagogia.md · legal.md · arquitectura.md
src/pages/            Inicio, NuevoExamen, Examen (panel), Apuntes, Resumenes, Esquemas, Flashcards,
                      Tests, ExamenPractica, Tutor (+ Feynman), Plan, Calendario, Perfil, Login,
                      Consentimiento (tutores) y Legal
src/components/       SubidaFotos, VisorFotoTexto, MapaConceptual, TarjetaFlashcard, Temporizador,
                      Graficos, Contenido (Markdown + KaTeX + citas), Celebracion…
src/lib/              supabase, api, fsrs, plan, progreso, corregir, citas, fragmentar, imagen, tipos…
netlify/functions/    trabajos, leer-apuntes-background, organizar-temas-background,
                      generar-material-background, corregir-background, tutor-background,
                      plan-estudio, consentimiento, privacidad (+ _shared: prompts, esquemas, IA, límites)
supabase/migrations/  esquema, RLS, consentimiento, Storage, rachas y búsqueda
tests/                unit (Vitest) · db (SQL de RLS) · e2e (Playwright)
scripts/              generar-muestras.mjs · prueba-lectura.ts
```
