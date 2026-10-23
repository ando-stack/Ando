/** Copia los snapshots generados por la ingesta a public/data para servirlos como estáticos. */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
for (const c of ['nba', 'euroleague', 'acb']) {
  const src = `data/snapshot/${c}.json`;
  mkdirSync('public/data', { recursive: true });
  if (existsSync(src)) {
    copyFileSync(src, `public/data/${c}.json`);
    console.log(`copiado ${src}`);
  } else console.log(`(sin datos de ${c})`);
}
