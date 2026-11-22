// Paso 1: abre las páginas públicas (competición, equipos y actas) con un navegador
// y guarda en ./raw los datos que esas páginas cargan. Uso: node crawl.js [idGrupo]
const { chromium } = require('playwright'); const fs = require('fs');
const GROUP = process.argv[2] || '629'; const OUT = 'raw'; const SITE = 'https://competicionesfrb.owbasket.com';
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); let cur = '';
  p.on('response', async r => { const u = r.url(); if (!/optimalwayconsulting/.test(u) || /getImages|getPhoto/.test(u)) return;
    let t = ''; try { t = await r.text(); } catch { return; }
    let j; try { j = JSON.parse(Buffer.from(t, 'base64').toString('utf8')); } catch { try { j = JSON.parse(t); } catch { return; } }
    const key = u.replace(/^.*optimalwayconsulting\.com\/(frb\/1\/[A-Za-z0-9]+\/)?/, '').replace(/\?.*/, '').replace(/[^\w-]+/g, '_');
    fs.writeFileSync(`${OUT}/${cur}__${key}.json`, JSON.stringify(j));
  });
  cur = 'comp'; await p.goto(`${SITE}/competicion/?id=${GROUP}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  const teams = [...new Set((await p.$$eval('a', as => as.map(a => a.href))).map(h => (h.match(/equipo\/\?id=(\d+)$/) || [])[1]).filter(Boolean))];
  for (const t of teams) { cur = 'team' + t; await p.goto(`${SITE}/equipo/?id=${t}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
    await p.click('.owbasket-shortcode-root >> text=ESTADÍSTICAS').catch(() => {}); await p.waitForTimeout(2500); /* carga el calendario del equipo */ console.log('equipo', t); }
  const matches = {};
  for (const f of fs.readdirSync(OUT).filter(f => f.includes('getByTeamAllSeason')))
    for (const m of JSON.parse(fs.readFileSync(`${OUT}/${f}`)).messageData) if (String(m.idGroup) === GROUP) matches[m.idMatch] = m;
  const all = Object.values(matches); fs.writeFileSync('matches.json', JSON.stringify(all));
  for (const m of all.filter(m => String(m.state) === '1' && !m.isLive && m.localScore != null && m.localScore !== '' && +m.localScore + +m.visitorScore > 0) /* solo partidos terminados */) {
    cur = 'match' + m.idMatch; if (fs.readdirSync(OUT).some(f => f.startsWith(cur + '__v1_frb_matches'))) continue; // ya descargada
    await p.goto(`${SITE}/partido/?uuid=${m.universallyid}&tab=1&season=${m.season}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
    console.log('acta J' + m.numMatchDay, m.nameLocalTeam, m.localScore, '-', m.visitorScore, m.nameVisitorTeam);
  }
  await b.close();
})();
