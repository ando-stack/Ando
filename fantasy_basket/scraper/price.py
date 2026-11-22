"""Fantasy scoring + pricing model. Input: dataset.json (from build.py). Output: game_data.json"""
import json, glob, collections
d = json.load(open('dataset.json'))
SHORT = {'CB CLAVIJO CADETE VERDE':'CLV','SOLUTIO SOTILLO':'SOT','ESCUTOR DANIEL 2011 BASKET 77':'ESC','BBR M11':'BBR',
         'CB CLAVIJO AZUL':'CLA','BRENER AGUSTINAS BASKET 2011':'AGU','LOGROBASKET 2011':'L11','LOGROBASKET 2012':'L12',
         'CRONOS':'CRO','ABQ CALAHORRA':'ABQ'}

def fp(g):
    """Fantasy points for one acta line. None = did not play."""
    if g['min'] == 0 and g['pts'] == 0: return None
    miss = (g['t2a']-g['t2m']) + (g['t3a']-g['t3m']); ftmiss = g['fta']-g['ftm']
    v = (g['pts'] + 0.5*g['t3m'] - 0.5*miss - 0.5*ftmiss - 0.5*g['fc'] - (3 if g['fc'] >= 5 else 0)
         + g['st'] + g['min']/10 + max(-4, min(4, g['pm']/5)) + (2 if g['res'] == 'W' else 0))
    return round(v, 1)

def coach_fp(my, their):
    m = my - their
    return round((10 if m > 0 else -2) + max(-6, min(6, m/5)), 1)

def player_price(avg):
    a = max(0.0, avg)
    return round(max(0.5, 0.5 + 0.33*a + 0.0045*a*a), 1)

def coach_price(avg):
    return round(max(0.5, 0.5 + 0.38*max(0, avg)), 1)

played = [g for g in d['games'] if g['hs'] is not None]
rounds = sorted({g['j'] for g in played})
def form_value(fp_by_round, team_rounds, recent=3):
    """50% media de la temporada + 50% media de los últimos `recent` partidos del equipo (no jugar = 0)."""
    if not team_rounds: return 0.0
    team_rounds = sorted(team_rounds)
    season = sum(fp_by_round.get(j, 0) for j in team_rounds) / len(team_rounds)
    last = team_rounds[-recent:]
    form = sum(fp_by_round.get(j, 0) for j in last) / len(last)
    return 0.5 * season + 0.5 * form

def team_games(tid, upto): return [g for g in played if g['j'] <= upto and tid in (g['home'], g['away'])]

teams = {}
for tid, t in d['teams'].items():
    cf = {}
    for g in team_games(tid, 99):
        my, th = (g['hs'], g['as']) if g['home'] == tid else (g['as'], g['hs'])
        cf[g['j']] = coach_fp(my, th)
    ph = [coach_price(form_value(cf, [g['j'] for g in team_games(tid, r)])) for r in rounds]
    teams[tid] = {'id': tid, 'n': t['name'], 's': SHORT.get(t['name'], t['name'][:3]), 'club': t['club'],
                  'coach': (t['coach'] or ['Sin entrenador'])[0], 'cf': cf, 'cp': ph[-1], 'cph': ph}  # solo el entrenador principal

players = []
for p in d['players'].values():
    for g in p['games']: g['fp'] = fp(g)
    gl = [g for g in p['games'] if g['fp'] is not None]
    hist = []
    for r in rounds:  # precio = mitad media de temporada + mitad forma de los 3 últimos partidos de su equipo
        hist.append(player_price(form_value({g['j']: g['fp'] for g in gl}, [g['j'] for g in team_games(p['team'], r)])))
    n = len(gl); tg = len(team_games(p['team'], 99)) or 1
    tot = collections.Counter()
    for g in gl:
        for k in ('min','pts','t2m','t2a','t3m','t3a','ftm','fta','fc','pm','st'): tot[k] += g[k]
    dors = collections.Counter(g['d'] for g in p['games']).most_common(1)
    players.append({'id': p['id'], 'n': p['name'], 't': p['team'], 'd': dors[0][0] if dors else '',
        'gp': n, 'tot': dict(tot), 'fpt': round(sum(g['fp'] for g in gl), 1), 'avg': round(sum(g['fp'] for g in gl)/tg, 1),
        'p': hist[-1], 'ph': hist,
        'g': [{k: g[k] for k in ('j','opp','res','sc','st','min','pts','t2m','t2a','t3m','t3a','ftm','fta','fc','pm','fp')} for g in sorted(p['games'], key=lambda x: x['j'])]})
players.sort(key=lambda x: -x['p'])

res = json.load(open(glob.glob('raw/comp__*FCBQWeb_resultats_*')[0]))['messageData']
standing = [{'t': s['idTeam'], 'pos': int(s['position']), 'pj': int(s['matchPlayed']), 'v': int(s['matchWin']), 'p': int(s['matchLost']),
             'pf': int(s['matchScoreFavour']), 'pc': int(s['matchScoreAgainst']), 'pts': int(s['standingScore'])} for s in res['standing']]
games = [{'j': g['j'], 'date': g['date'], 'h': g['home'], 'a': g['away'], 'hs': g['hs'], 'as': g['as'], 'f': g['field']} for g in d['games']]

top = sorted((p['p'] for p in players), reverse=True)
budget = 5 * round((sum(top[:10]) + max(t['cp'] for t in teams.values())) * 0.62 / 5)
out = {'meta': {'competition': 'Cadete Masculino · Liga A1', 'season': '2026-27', 'rounds': rounds, 'lastRound': rounds[-1],
                'totalRounds': int(res.get('totalRounds', 18)), 'budget': budget, 'source': 'Actas oficiales FRB (owbasket)',
                'updated': max(g['date'] for g in played)[:10]},
       'teams': teams, 'players': players, 'games': games, 'standing': standing}
json.dump(out, open('../data.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('budget', budget, 'players', len(players), 'top prices', top[:8], 'coach prices', sorted((t['cp'], t['s']) for t in teams.values()))
