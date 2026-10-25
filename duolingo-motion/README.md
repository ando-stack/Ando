# Motion graphic de Duolingo (Remotion)

Vídeo vertical 1080x1920, 30 fps, ~17 s. Escenas: intro con el búho, idiomas, lección con respuesta correcta, racha de 365 días y cierre con "Empieza gratis".

```bash
npm install
npm run studio   # editar y previsualizar
npm run render   # genera out/duolingo.mp4
```

El código está en `src/DuolingoPromo.tsx` (escenas y duraciones en `D`) y `src/Owl.tsx` (búho dibujado en SVG, versión original, no el logo oficial).
