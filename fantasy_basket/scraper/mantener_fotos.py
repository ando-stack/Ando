"""Aplica nombres.json y copia en ../data.json los enlaces a las fotos que ya hay en ../fotos (no descarga ninguna foto nueva).
Uso: python3 mantener_fotos.py <data.json anterior>"""
import json, os, sys
old = json.load(open(sys.argv[1])); new = json.load(open('../data.json'))
oldp = {p['id']: p for p in old['players']}
exists = lambda rel: rel and os.path.exists('../' + rel)
for p in new['players']:
    img = oldp.get(p['id'], {}).get('img')
    if exists(img): p['img'] = img
for tid, t in new['teams'].items():
    o = old['teams'].get(tid, {})
    if o.get('cph_img'): t['cph_img'] = [x if exists(x) else None for x in o['cph_img'][:1]]
    if o.get('coaches'): t['coaches'] = o['coaches'][:1]
# nombres corregidos a mano (id -> nombre), se mantienen en cada actualización
if os.path.exists('nombres.json'):
    fix = json.load(open('nombres.json'))
    for p in new['players']:
        if p['id'] in fix: p['n'] = fix[p['id']]
json.dump(new, open('../data.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('fotos mantenidas:', sum(1 for p in new['players'] if p.get('img')), 'jugadores,', sum(1 for t in new['teams'].values() if any(t.get('cph_img') or [])), 'entrenadores')
