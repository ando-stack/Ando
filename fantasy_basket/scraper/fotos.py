"""Paso 4 (opcional): descarga las fotos de las plantillas oficiales, las recorta a la cara
y las enlaza en ../data.json. Los jugadores sin foto en la federación se quedan sin foto.
Uso: python3 fotos.py"""
import json, glob, os, sys, urllib.request
from PIL import Image, ImageOps
DL = 'fotos_dl'; OUT = '../fotos'; os.makedirs(DL, exist_ok=True); os.makedirs(OUT, exist_ok=True)
data = json.load(open('../data.json')); P = {p['id']: p for p in data['players']}
def square(src, dst, size):
    im = ImageOps.exif_transpose(Image.open(src)).convert('RGB'); w, h = im.size; s = min(w, h); top = max(0, (h - s) // 3)
    im.crop(((w - s) // 2, top, (w - s) // 2 + s, top + s)).resize((size, size), Image.LANCZOS).save(dst, quality=80)
def fetch(url, dst):
    if not os.path.exists(dst): urllib.request.urlretrieve(url, dst)
for f in glob.glob('raw/team*__FCBQWeb_getTeamCard*'):
    d = json.load(open(f))['messageData']; tid = d['team']['idSignedTeam']; coach_imgs = []; coach_names = []
    for p in d['players']:
        lt = p['licenseTypeName'] or ''; url = p.get('photoUrl')
        if 'ENTREN' in lt and not coach_names:  # solo el entrenador principal
            coach_names.append(p['name'] + ' ' + p['surname']); i = len(coach_imgs)
            if url:
                fetch(url, f'{DL}/c{tid}_{i}'); square(f'{DL}/c{tid}_{i}', f'{OUT}/entrenador_{tid}_{i}.jpg', 200); coach_imgs.append(f'fotos/entrenador_{tid}_{i}.jpg')
            else: coach_imgs.append(None)
        elif 'JUGADOR' in lt and url and p['uuid'] in P:
            fetch(url, f'{DL}/{p["uuid"]}'); square(f'{DL}/{p["uuid"]}', f'{OUT}/{p["uuid"]}.jpg', 160); P[p['uuid']]['img'] = f'fotos/{p["uuid"]}.jpg'
    data['teams'][tid]['cph_img'] = coach_imgs; data['teams'][tid]['coaches'] = coach_names
json.dump(data, open('../data.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('jugadores con foto:', sum(1 for p in data['players'] if p.get('img')), 'de', len(data['players']))
