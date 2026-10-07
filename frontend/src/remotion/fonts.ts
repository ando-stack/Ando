import {continueRender, delayRender} from 'remotion';

// Fuentes con licencia libre (SIL OFL) incluidas en /assets/fonts
export const FONT_FILES: Record<string, {file: string; weight: string}[]> = {
  Montserrat: [
    {file: 'Montserrat-ExtraBold.woff2', weight: '800'},
    {file: 'Montserrat-SemiBold.woff2', weight: '600'},
  ],
  Anton: [{file: 'Anton-Regular.woff2', weight: '400'}],
  BebasNeue: [{file: 'BebasNeue-Regular.woff2', weight: '400'}],
  Poppins: [{file: 'Poppins-ExtraBold.woff2', weight: '800'}],
  Inter: [{file: 'Inter-Bold.woff2', weight: '700'}],
};

export const fontWeight = (font: string, bold: boolean) => {
  const w = FONT_FILES[font]?.map((f) => f.weight) ?? ['700'];
  return bold ? w[0] : w[w.length - 1];
};

const loaded = new Set<string>();

export function loadFonts(assetsUrl: string) {
  if (typeof document === 'undefined' || loaded.has(assetsUrl)) return;
  loaded.add(assetsUrl);
  const handle = delayRender('Cargando fuentes');
  const all: Promise<unknown>[] = [];
  for (const [family, files] of Object.entries(FONT_FILES)) {
    for (const f of files) {
      const face = new FontFace(family, `url(${assetsUrl}fonts/${f.file}) format('woff2')`, {weight: f.weight});
      all.push(
        face
          .load()
          .then((ff) => document.fonts.add(ff))
          .catch((e) => console.warn('No se pudo cargar la fuente', f.file, e)),
      );
    }
  }
  Promise.all(all).finally(() => continueRender(handle));
}
