# 🏭 Shorts Factory: Money Untold

Fábrica de YouTube Shorts en **inglés** sobre historias de dinero y negocios.
Claude escribe los guiones y los vídeos se generan solos con **Remotion** y **voces de Google**.

## Qué hay en cada Short

```
outputs/
└── 001-rejected-google-for-750k/
    ├── video.mp4          ← el Short, listo para subir (1080×1920, menos de 60 s)
    ├── info.txt           ← título, descripción y hashtags para copiar y pegar
    └── extras/
        ├── thumbnail.png  ← miniatura (o portada de TikTok/Reels)
        └── script.txt     ← guion, textos en pantalla y fuentes para comprobar los datos
```

Los guiones se guardan en `lotes/lote-001.json`, `lote-002.json`… (15 Shorts por lote).

## Cómo pedir más

Escribe a Claude: **"haz guiones"**. Escribe 15 historias nuevas (sin repetir ninguna), renderiza los 15 vídeos
y los sube al repositorio. Las instrucciones exactas están en `CLAUDE.md`.

## Voces de Google

| Voz | Calidad | Qué necesitas |
|---|---|---|
| **Google Translate** (por defecto) | Robótica | Nada, es gratis |
| **Google Cloud Text-to-Speech** ⭐ | Natural, de narrador | Una clave de API gratuita (≈1 millón de caracteres gratis al mes, de sobra para un Short diario) |

**Recomendado: usa Google Cloud.** Con la voz robótica es más difícil retener a la gente y monetizar.

Cómo conseguir la clave:
1. Entra en <https://console.cloud.google.com>, crea un proyecto y activa **Cloud Text-to-Speech API**.
2. **APIs y servicios → Credenciales → Crear credenciales → Clave de API**. Restríngela a Text-to-Speech.
3. Antes de renderizar, ponla en la variable `GOOGLE_TTS_API_KEY`.
   Si quieres que Claude la use, añádela como *secret* en la configuración del entorno de Claude Code.
   **No la pegues en el chat ni en un archivo del repositorio.**

La voz se cambia en `config.json` (`voice.cloud.name`). Buenas opciones de narrador:
`en-US-Neural2-J`, `en-US-Neural2-D`, `en-US-Studio-Q`, `en-GB-Neural2-B`.

## Renderizar en tu ordenador (opcional)

Necesitas [Node.js 20 o superior](https://nodejs.org).

```bash
cd shorts-factory
npm install
npm run render                          # renderiza todo lo que falte
npm run render -- lotes/lote-002.json   # solo un lote
npm run render -- --only 7 --force      # vuelve a hacer el Short 7
npm run studio                          # editor visual de Remotion para tocar el diseño
```

El nombre y el @ del canal se cambian en `config.json`.

## Subir a YouTube

1. YouTube Studio → **Crear → Subir vídeos** → `video.mp4`.
2. Copia título, descripción y hashtags de `info.txt`.
3. En la app de YouTube del móvil puedes elegir la portada del Short. `thumbnail.png` te sirve para TikTok, Reels y como referencia.
4. Si YouTube te pregunta por **contenido alterado o sintético**, responde según el vídeo. Estos vídeos son gráficos animados con voz sintética y no muestran personas reales falsas, así que normalmente es "No".
5. Publica 1 Short al día a la misma hora. Para audiencia de EE. UU., prueba entre las 12:00 y las 15:00 hora de Nueva York (18:00–21:00 en España).

## Consejos para crecer y monetizar

- Revisa cada domingo en YouTube Studio la retención y el porcentaje de gente que se quedó viendo o deslizó. Pide más historias del tipo que mejor funcione.
- **Monetización:** Programa de Partners de YouTube (1.000 suscriptores + 10 millones de vistas de Shorts en 90 días). Además, enlaces de afiliado a libros de negocios en la descripción y, más adelante, vídeos largos recopilatorios, que pagan mucho más.
- **Para no tener problemas con la política de contenido masivo de YouTube:** guiones originales, datos comprobados (mira `extras/script.txt`) y siempre el mismo estilo y la misma voz. Antes de publicar, dedica un minuto a revisar cada vídeo.

## Licencias

- **Remotion** es gratis para personas y empresas de hasta 3 trabajadores. Si creces más, mira <https://remotion.dev/license>.
- La fuente **Montserrat** usa la licencia SIL Open Font License (`public/fonts/OFL.txt`).
- Los vídeos no usan música ni clips ajenos. Si añades música, usa la biblioteca de audio de YouTube.
