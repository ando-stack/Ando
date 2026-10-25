#!/usr/bin/env python3
"""
Descarga el calendario completo de la temporada, los resultados con estadísticas
(xG, córners, faltas, tarjetas, tiros a puerta) y las cuotas de las casas, entrena
el modelo y genera web/datos.json para la web de apuestas.

Fuentes (gratis, sin registro):
  - fixturedownload.com  -> calendario completo con jornadas (8 competiciones)
  - football-data.co.uk  -> resultados, estadísticas y cuotas (cierre y próximas)

Uso:  python3 actualizar_datos.py
Solo usa la biblioteca estándar de Python.
"""
import csv
import difflib
import io
import json
import math
import os
import sys
import time
import unicodedata
import urllib.request
from datetime import date, datetime, timedelta, timezone

AQUI = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(AQUI, ".cache")
SALIDA = os.path.join(AQUI, "web", "datos.json")

HOY = datetime.now(timezone.utc).date()
ANIO = HOY.year if HOY.month >= 7 else HOY.year - 1          # 2026 -> temporada 2026/27
FD_ACTUAL = f"{ANIO % 100:02d}{(ANIO + 1) % 100:02d}"         # "2627"
FD_ANTERIOR = f"{(ANIO - 1) % 100:02d}{ANIO % 100:02d}"       # "2526"

# ---------------------------------------------------------------------------
# Competiciones
# ---------------------------------------------------------------------------
COMPETICIONES = [
    {"id": "laliga", "nombre": "LaLiga EA Sports", "corto": "LaLiga", "bandera": "🇪🇸", "fx": "la-liga", "div": "SP1"},
    {"id": "premier", "nombre": "Premier League", "corto": "Premier", "bandera": "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "fx": "epl", "div": "E0"},
    {"id": "seriea", "nombre": "Serie A", "corto": "Serie A", "bandera": "🇮🇹", "fx": "serie-a", "div": "I1"},
    {"id": "bundesliga", "nombre": "Bundesliga", "corto": "Bundesliga", "bandera": "🇩🇪", "fx": "bundesliga", "div": "D1"},
    {"id": "ligue1", "nombre": "Ligue 1", "corto": "Ligue 1", "bandera": "🇫🇷", "fx": "ligue-1", "div": "F1"},
    {"id": "champions", "nombre": "UEFA Champions League", "corto": "Champions", "bandera": "⭐", "fx": "champions-league", "div": None},
    {"id": "europa", "nombre": "UEFA Europa League", "corto": "Europa League", "bandera": "🟠", "fx": "europa-league", "div": None},
    {"id": "conference", "nombre": "UEFA Conference League", "corto": "Conference", "bandera": "🟢", "fx": "conference-league", "div": None},
]

# Ligas de football-data.co.uk con estadísticas completas.
# Valor = (país, fuerza de la liga en escala logarítmica; Premier = 0).
DIVS = {
    "E0": ("ENG", 0.00), "E1": ("ENG", -0.40),
    "SP1": ("ESP", -0.04), "SP2": ("ESP", -0.42),
    "I1": ("ITA", -0.07), "I2": ("ITA", -0.45),
    "D1": ("GER", -0.06), "D2": ("GER", -0.40),
    "F1": ("FRA", -0.13), "F2": ("FRA", -0.48),
    "P1": ("POR", -0.22), "N1": ("NED", -0.24), "B1": ("BEL", -0.28),
    "T1": ("TUR", -0.30), "SC0": ("SCO", -0.40), "G1": ("GRE", -0.38),
}
SEGUNDAS = {"E1", "SP2", "I2", "D2", "F2"}   # solo temporada anterior (equipos ascendidos)

# Ligas "extra" (solo goles y cuotas) para equipos de competiciones europeas.
NUEVAS = {
    "AUT": ("AUT", -0.40), "SWZ": ("SUI", -0.42), "DNK": ("DEN", -0.40),
    "NOR": ("NOR", -0.45), "SWE": ("SWE", -0.52), "POL": ("POL", -0.48), "ROU": ("ROU", -0.55),
}

# Equipos europeos sin liga en las fuentes: país y fuerza aproximada (se corrige con sus resultados europeos).
SIN_LIGA = {
    "Shakhtar": ("UKR", -0.42), "Slavia Praha": ("CZE", -0.38), "Sparta Praha": ("CZE", -0.42),
    "Viktoria Plzen": ("CZE", -0.45), "Jablonec": ("CZE", -0.58), "S. Bratislava": ("SVK", -0.60),
    "Sabah": ("AZE", -0.70), "Crvena Zvezda": ("SRB", -0.45), "GNK Dinamo": ("CRO", -0.45),
    "Hajduk Split": ("CRO", -0.55), "Ferencváros": ("HUN", -0.50), "Celje": ("SVN", -0.62),
    "Omonia": ("CYP", -0.58), "Pafos": ("CYP", -0.55), "Levski Sofia": ("BUL", -0.65),
    "CSKA Sofia": ("BUL", -0.70), "H. Beer-Sheva": ("ISR", -0.58), "Ararat-Armenia": ("ARM", -0.85),
    "Kairat Almaty": ("KAZ", -0.75), "Egnatia": ("ALB", -0.90), "Borac": ("BIH", -0.85),
    "Iberia Tbilisi": ("GEO", -0.90), "Riga": ("LVA", -0.85), "Kauno Žalgiris": ("LTU", -0.90),
    "KuPS Kuopio": ("FIN", -0.80), "Inter Escaldes": ("AND", -1.15), "L. Red Imps": ("GIB", -1.20),
    "Torreense": ("POR", -0.62),
}
FUERZA_DESCONOCIDA = -0.75

# Nombres del calendario (fixturedownload) -> nombres de football-data.co.uk
ALIAS = {
    # Premier
    "Man Utd": "Man United", "Spurs": "Tottenham",
    # LaLiga
    "Athletic Club": "Ath Bilbao", "Atlético de Madrid": "Ath Madrid", "Atleti": "Ath Madrid",
    "CA Osasuna": "Osasuna", "Deportivo Alavés": "Alaves", "Elche CF": "Elche", "FC Barcelona": "Barcelona",
    "Getafe CF": "Getafe", "Levante UD": "Levante", "Málaga CF": "Malaga", "R. Racing Club": "Santander",
    "RC Deportivo": "La Coruna", "RCD Espanyol de Barcelona": "Espanol", "Rayo Vallecano": "Vallecano",
    "Real Betis": "Betis", "Real Sociedad": "Sociedad", "Sevilla FC": "Sevilla", "Valencia CF": "Valencia",
    "Villarreal CF": "Villarreal",
    # Serie A
    "Internazionale": "Inter",
    # Bundesliga
    "1. FC Köln": "FC Koln", "1. FC Union Berlin": "Union Berlin", "1. FSV Mainz 05": "Mainz",
    "Bayer 04 Leverkusen": "Leverkusen", "Borussia Dortmund": "Dortmund", "B. Dortmund": "Dortmund",
    "Borussia Mönchengladbach": "M'gladbach", "Eintracht Frankfurt": "Ein Frankfurt", "FC Augsburg": "Augsburg",
    "FC Bayern München": "Bayern Munich", "Bayern München": "Bayern Munich", "FC Schalke 04": "Schalke 04",
    "Hamburger SV": "Hamburg", "SC Paderborn 07": "Paderborn", "SV Elversberg": "Elversberg",
    "SV Werder Bremen": "Werder Bremen", "Sport-Club Freiburg": "Freiburg", "TSG Hoffenheim": "Hoffenheim",
    "VfB Stuttgart": "Stuttgart", "Leipzig": "RB Leipzig",
    # Ligue 1
    "AJ Auxerre": "Auxerre", "AS Monaco": "Monaco", "Angers SCO": "Angers", "Estac Troyes": "Troyes",
    "FC Lorient": "Lorient", "Havre Athletic Club": "Le Havre", "LOSC Lille": "Lille", "Le Mans FC": "Le Mans",
    "OGC Nice": "Nice", "Olympique Lyonnais": "Lyon", "Olympique de Marseille": "Marseille",
    "Paris Saint-Germain": "Paris SG", "Paris": "Paris SG", "RC Lens": "Lens",
    "RC Strasbourg Alsace": "Strasbourg", "Stade Brestois 29": "Brest", "Stade Rennais FC": "Rennes",
    "Toulouse FC": "Toulouse",
    # Europa
    "AEK Athens": "AEK", "Fenerbahçe": "Fenerbahce", "PSV": "PSV Eindhoven", "Sporting CP": "Sp Lisbon",
    "Bodø/Glimt": "Bodo/Glimt", "N.E.C.": "Nijmegen", "Olympiacos": "Olympiakos", "Union SG": "St. Gilloise",
    "Lillestrøm": "Lillestrom", "Braga": "Sp Braga", "Copenhagen": "FC Copenhagen",
    "Mjällby": "Mjallby", "Nordsjælland": "Nordsjaelland", "Sint-Truidense": "St Truiden",
    "U. Craiova": "Univ. Craiova",
}

# Nombres en español para mostrar
NOMBRE_BONITO = {
    "Ath Madrid": "Atlético de Madrid", "Ath Bilbao": "Athletic Club", "Sociedad": "Real Sociedad",
    "Betis": "Real Betis", "Espanol": "Espanyol", "La Coruna": "Deportivo", "Santander": "Racing Santander",
    "Vallecano": "Rayo Vallecano", "Alaves": "Alavés", "Malaga": "Málaga", "Man United": "Manchester United",
    "Man City": "Manchester City", "Tottenham": "Tottenham", "Nott'm Forest": "Nottingham Forest",
    "Bayern Munich": "Bayern Múnich", "Ein Frankfurt": "Eintracht Frankfurt", "M'gladbach": "Borussia M'gladbach",
    "FC Koln": "Colonia", "Paris SG": "PSG", "Sp Lisbon": "Sporting CP", "Sp Braga": "Braga",
    "St. Gilloise": "Union SG", "Olympiakos": "Olympiacos", "Univ. Craiova": "U. Craiova",
    "Dortmund": "Borussia Dortmund", "Leverkusen": "Bayer Leverkusen", "Inter": "Inter de Milán",
    "Milan": "AC Milan", "Juventus": "Juventus", "Bodo/Glimt": "Bodø/Glimt",
}


# ---------------------------------------------------------------------------
# Descargas
# ---------------------------------------------------------------------------
def descargar(url, nombre, max_horas=3):
    """Descarga con caché y reintentos. Si falla, usa la copia en caché."""
    os.makedirs(CACHE, exist_ok=True)
    ruta = os.path.join(CACHE, nombre)
    if os.path.exists(ruta) and time.time() - os.path.getmtime(ruta) < max_horas * 3600:
        return open(ruta, "rb").read()
    ultimo_error = None
    for intento in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (apuestas-modelo)"})
            with urllib.request.urlopen(req, timeout=40) as r:
                datos = r.read()
            if len(datos) < 20:
                raise IOError("respuesta vacía")
            open(ruta, "wb").write(datos)
            return datos
        except Exception as e:  # noqa: BLE001
            ultimo_error = e
            time.sleep(2 ** intento)
    if os.path.exists(ruta):
        print(f"  ! {nombre}: sin conexión ({ultimo_error}); uso la caché", file=sys.stderr)
        return open(ruta, "rb").read()
    print(f"  ! {nombre}: no disponible ({ultimo_error})", file=sys.stderr)
    return None


def leer_csv(datos):
    if not datos:
        return []
    texto = datos.decode("utf-8-sig", errors="replace")
    return [r for r in csv.DictReader(io.StringIO(texto)) if r.get("HomeTeam") or r.get("Home")]


def num(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def fecha_fd(s):
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(s.strip(), fmt).date()
        except (ValueError, AttributeError):
            pass
    return None


def normal(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    for q in (" fc", "fc ", " cf", "cf ", " ac", "ac ", " sc", "sc ", "afc ", " afc", ".", "-", "'"):
        s = s.replace(q, " ")
    return " ".join(s.split())


# ---------------------------------------------------------------------------
# Partidos históricos
# ---------------------------------------------------------------------------
class Partido:
    __slots__ = ("fecha", "div", "loc", "vis", "gl", "gv", "xl", "xv", "stats", "cuotas", "arbitro", "europeo")

    def __init__(self, **kw):
        for k in self.__slots__:
            setattr(self, k, kw.get(k))


STATS = {"c": ("HC", "AC"), "f": ("HF", "AF"), "tp": ("HST", "AST")}


def cuotas_de_fila(r, cierre):
    """Cuotas 1X2, más/menos 2.5 y hándicap asiático de una fila de football-data."""
    C = "C" if cierre else ""
    out = {}
    x12 = {}
    for casa, pref in (("b365", "B365"), ("avg", "Avg"), ("max", "Max")):
        t = [num(r.get(f"{pref}{C}{s}")) for s in "HDA"]
        if all(t):
            x12[casa] = t
    if x12:
        out["1x2"] = x12
    ou = {}
    for casa, pref in (("b365", "B365"), ("avg", "Avg"), ("max", "Max")):
        t = [num(r.get(f"{pref}{C}>2.5")), num(r.get(f"{pref}{C}<2.5"))]
        if all(t):
            ou[casa] = t
    if ou:
        out["ou25"] = ou
    linea = num(r.get("AHCh" if cierre else "AHh"))
    if linea is not None:
        ah = {"linea": linea}
        for casa, pref in (("b365", "B365"), ("avg", "Avg"), ("max", "Max")):
            t = [num(r.get(f"{pref}{C}AHH")), num(r.get(f"{pref}{C}AHA"))]
            if all(t):
                ah[casa] = t
        if len(ah) > 1:
            out["ah"] = ah
    return out


def cargar_fd():
    partidos = []
    equipos_div = {}  # clave -> (div, fecha más reciente)
    for div, (pais, _) in DIVS.items():
        temporadas = [FD_ANTERIOR] if div in SEGUNDAS else [FD_ANTERIOR, FD_ACTUAL]
        for t in temporadas:
            filas = leer_csv(descargar(f"https://www.football-data.co.uk/mmz4281/{t}/{div}.csv", f"{div}_{t}.csv"))
            for r in filas:
                f = fecha_fd(r.get("Date", ""))
                gl, gv = num(r.get("FTHG")), num(r.get("FTAG"))
                if not f or gl is None or gv is None:
                    continue
                loc, vis = f"{pais}:{r['HomeTeam'].strip()}", f"{pais}:{r['AwayTeam'].strip()}"
                stats = {}
                for k, (a, b) in STATS.items():
                    va, vb = num(r.get(a)), num(r.get(b))
                    if va is not None and vb is not None:
                        stats[k] = (va, vb)
                yl, yv, rl, rv = (num(r.get(c)) for c in ("HY", "AY", "HR", "AR"))
                if None not in (yl, yv, rl, rv):
                    stats["t"] = (yl + rl, yv + rv)
                partidos.append(Partido(
                    fecha=f, div=div, loc=loc, vis=vis, gl=gl, gv=gv,
                    xl=num(r.get("HxG")), xv=num(r.get("AxG")), stats=stats,
                    cuotas=cuotas_de_fila(r, cierre=True), arbitro=(r.get("Referee") or "").strip() or None,
                    europeo=False))
                for k in (loc, vis):
                    if k not in equipos_div or equipos_div[k][1] <= f:
                        equipos_div[k] = (div, f)
    limite = HOY - timedelta(days=430)
    for cod, (pais, _) in NUEVAS.items():
        for r in leer_csv(descargar(f"https://www.football-data.co.uk/new/{cod}.csv", f"new_{cod}.csv", 12)):
            f = fecha_fd(r.get("Date", ""))
            gl, gv = num(r.get("HG")), num(r.get("AG"))
            if not f or f < limite or gl is None or gv is None:
                continue
            loc, vis = f"{pais}:{r['Home'].strip()}", f"{pais}:{r['Away'].strip()}"
            partidos.append(Partido(fecha=f, div=cod, loc=loc, vis=vis, gl=gl, gv=gv, stats={}, cuotas={}, europeo=False))
            for k in (loc, vis):
                if k not in equipos_div or equipos_div[k][1] <= f:
                    equipos_div[k] = (cod, f)
    return partidos, {k: v[0] for k, v in equipos_div.items()}


def fuerza_div(div):
    if div in DIVS:
        return DIVS[div][1]
    if div in NUEVAS:
        return NUEVAS[div][1]
    return FUERZA_DESCONOCIDA


# ---------------------------------------------------------------------------
# Calendario
# ---------------------------------------------------------------------------
def emparejar_nombre(nombre_fx, comp, equipos_div):
    """Devuelve la clave interna (PAÍS:nombre_fd) de un equipo del calendario."""
    if comp["div"]:
        pais = DIVS[comp["div"]][0]
        candidatos = {k.split(":", 1)[1]: k for k, d in equipos_div.items() if k.startswith(pais + ":")}
    else:
        candidatos = {}
        for k in equipos_div:
            candidatos.setdefault(k.split(":", 1)[1], k)
    n = ALIAS.get(nombre_fx, nombre_fx)
    if n in candidatos:
        return candidatos[n]
    if nombre_fx in SIN_LIGA:
        return f"{SIN_LIGA[nombre_fx][0]}:{nombre_fx}"
    por_normal = {normal(c): k for c, k in candidatos.items()}
    if normal(n) in por_normal:
        return por_normal[normal(n)]
    parecido = difflib.get_close_matches(normal(n), list(por_normal), n=1, cutoff=0.82)
    if parecido:
        return por_normal[parecido[0]]
    return f"XXX:{nombre_fx}"


def cargar_calendario(equipos_div):
    partidos = []
    no_emparejados = set()
    for comp in COMPETICIONES:
        datos = descargar(f"https://fixturedownload.com/feed/json/{comp['fx']}-{ANIO}", f"fx_{comp['fx']}.json")
        if not datos:
            continue
        for m in json.loads(datos):
            loc = emparejar_nombre(m["HomeTeam"], comp, equipos_div)
            vis = emparejar_nombre(m["AwayTeam"], comp, equipos_div)
            for k, n in ((loc, m["HomeTeam"]), (vis, m["AwayTeam"])):
                if k.startswith("XXX:"):
                    no_emparejados.add(f"{comp['id']}: {n}")
            fecha = datetime.strptime(m["DateUtc"].replace("Z", ""), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            res = None
            if m.get("HomeTeamScore") is not None and m.get("AwayTeamScore") is not None:
                res = [int(m["HomeTeamScore"]), int(m["AwayTeamScore"])]
            partidos.append({
                "comp": comp["id"], "jornada": m["RoundNumber"], "fecha": fecha,
                "loc": loc, "vis": vis, "nl": m["HomeTeam"], "nv": m["AwayTeam"],
                "estadio": m.get("Location") or "", "res": res, "num": m.get("MatchNumber"),
            })
    if no_emparejados:
        print("  Equipos sin datos de liga (se valoran por sus partidos europeos):", ", ".join(sorted(no_emparejados)))
    return partidos


# ---------------------------------------------------------------------------
# Modelo de goles: Poisson log-lineal con regularización hacia la fuerza de la liga
# ---------------------------------------------------------------------------
VIDA_MEDIA = 120.0   # días: un partido de hace 120 días pesa la mitad
RIDGE = 4.0


def peso(fecha, corte):
    return 0.5 ** ((corte - fecha).days / VIDA_MEDIA)


def objetivo_goles(p, lado):
    g = p.gl if lado == 0 else p.gv
    x = p.xl if lado == 0 else p.xv
    return 0.4 * g + 0.6 * x if x is not None else g


def ajustar_goles(partidos, prior, corte):
    ms = [(p, peso(p.fecha, corte)) for p in partidos if p.fecha < corte]
    equipos = set()
    for p, _ in ms:
        equipos.update((p.loc, p.vis))
    att = {t: prior.get(t, FUERZA_DESCONOCIDA) for t in equipos}
    dfn = dict(att)
    pri = dict(att)
    c, h = math.log(1.3), 0.22
    datos = [(p.loc, p.vis, objetivo_goles(p, 0), objetivo_goles(p, 1), w) for p, w in ms]
    for it in range(40):
        for bloque in ("att", "dfn", "ch"):
            g = {}
            H = {}
            gc = Hc = gh = Hh = 0.0
            for lo, vi, yl, yv, w in datos:
                ll = math.exp(c + h + att[lo] - dfn[vi])
                lv = math.exp(c + att[vi] - dfn[lo])
                if bloque == "att":
                    g[lo] = g.get(lo, 0) + w * (yl - ll); H[lo] = H.get(lo, 0) + w * ll
                    g[vi] = g.get(vi, 0) + w * (yv - lv); H[vi] = H.get(vi, 0) + w * lv
                elif bloque == "dfn":
                    g[vi] = g.get(vi, 0) - w * (yl - ll); H[vi] = H.get(vi, 0) + w * ll
                    g[lo] = g.get(lo, 0) - w * (yv - lv); H[lo] = H.get(lo, 0) + w * lv
                else:
                    gc += w * (yl - ll + yv - lv); Hc += w * (ll + lv)
                    gh += w * (yl - ll); Hh += w * ll
            if bloque == "att":
                for t in att:
                    att[t] += (g.get(t, 0) - RIDGE * (att[t] - pri[t])) / (H.get(t, 0) + RIDGE)
            elif bloque == "dfn":
                for t in dfn:
                    dfn[t] += (g.get(t, 0) - RIDGE * (dfn[t] - pri[t])) / (H.get(t, 0) + RIDGE)
            else:
                c += gc / Hc
                h += gh / Hh
    partidos_efectivos = {}
    for p, w in ms:
        for t in (p.loc, p.vis):
            partidos_efectivos[t] = partidos_efectivos.get(t, 0) + w
    return {"c": c, "h": h, "att": att, "dfn": dfn, "n": partidos_efectivos}


def lambdas(modelo, loc, vis, prior):
    a_l = modelo["att"].get(loc, prior.get(loc, FUERZA_DESCONOCIDA))
    d_l = modelo["dfn"].get(loc, prior.get(loc, FUERZA_DESCONOCIDA))
    a_v = modelo["att"].get(vis, prior.get(vis, FUERZA_DESCONOCIDA))
    d_v = modelo["dfn"].get(vis, prior.get(vis, FUERZA_DESCONOCIDA))
    return (math.exp(modelo["c"] + modelo["h"] + a_l - d_v), math.exp(modelo["c"] + a_v - d_l))


# ---------------------------------------------------------------------------
# Modelo de estadísticas (córners, faltas, tarjetas, tiros a puerta)
# log(media local) = base_liga + casa + a_favor(local) - en_contra(visitante)
# ---------------------------------------------------------------------------
def ajustar_stat(partidos, clave, corte, equipos_div):
    ms = [(p, peso(p.fecha, corte)) for p in partidos if p.fecha < corte and clave in p.stats]
    if not ms:
        return None
    base = {}
    for p, w in ms:
        s = p.stats[clave]
        b = base.setdefault(p.div, [0.0, 0.0])
        b[0] += w * (s[0] + s[1]); b[1] += 2 * w
    base = {d: math.log(max(v[0] / v[1], 0.05)) for d, v in base.items()}
    fav, con = {}, {}
    for p, _ in ms:
        for t in (p.loc, p.vis):
            fav[t] = 0.0; con[t] = 0.0
    h = 0.05
    r = 6.0
    for it in range(30):
        for bloque in ("fav", "con", "h"):
            g, H = {}, {}
            gh = Hh = 0.0
            gb, Hb = {}, {}
            for p, w in ms:
                yl, yv = p.stats[clave]
                ml = math.exp(base[p.div] + h + fav[p.loc] - con[p.vis])
                mv = math.exp(base[p.div] + fav[p.vis] - con[p.loc])
                if bloque == "fav":
                    g[p.loc] = g.get(p.loc, 0) + w * (yl - ml); H[p.loc] = H.get(p.loc, 0) + w * ml
                    g[p.vis] = g.get(p.vis, 0) + w * (yv - mv); H[p.vis] = H.get(p.vis, 0) + w * mv
                elif bloque == "con":
                    g[p.vis] = g.get(p.vis, 0) - w * (yl - ml); H[p.vis] = H.get(p.vis, 0) + w * ml
                    g[p.loc] = g.get(p.loc, 0) - w * (yv - mv); H[p.loc] = H.get(p.loc, 0) + w * mv
                else:
                    gh += w * (yl - ml); Hh += w * ml
                    gb[p.div] = gb.get(p.div, 0) + w * (yl - ml + yv - mv)
                    Hb[p.div] = Hb.get(p.div, 0) + w * (ml + mv)
            if bloque == "fav":
                for t in fav:
                    fav[t] += (g.get(t, 0) - r * fav[t]) / (H.get(t, 0) + r)
            elif bloque == "con":
                for t in con:
                    con[t] += (g.get(t, 0) - r * con[t]) / (H.get(t, 0) + r)
            else:
                h += gh / Hh
                for d in base:
                    base[d] += gb[d] / Hb[d]
    # Dispersión (binomial negativa): var = mu + mu^2 / k, estimada sobre el total del partido
    sm2 = sexc = 0.0
    sm2e = sexce = 0.0
    for p, w in ms:
        yl, yv = p.stats[clave]
        ml = math.exp(base[p.div] + h + fav[p.loc] - con[p.vis])
        mv = math.exp(base[p.div] + fav[p.vis] - con[p.loc])
        mt = ml + mv
        sm2 += w * mt * mt; sexc += w * ((yl + yv - mt) ** 2 - mt)
        for y, m in ((yl, ml), (yv, mv)):
            sm2e += w * m * m; sexce += w * ((y - m) ** 2 - m)
    k_total = sm2 / sexc if sexc > 0 else 500.0
    k_equipo = sm2e / sexce if sexce > 0 else 500.0
    return {"base": base, "h": h, "fav": fav, "con": con,
            "k": round(min(k_total, 500.0), 2), "ke": round(min(k_equipo, 500.0), 2)}


def medias_stat(modelo, loc, vis, equipos_div):
    if not modelo:
        return None
    dl, dv = equipos_div.get(loc), equipos_div.get(vis)
    bases = [modelo["base"][d] for d in (dl, dv) if d in modelo["base"]]
    if not bases:
        b = sum(modelo["base"].values()) / len(modelo["base"])
    else:
        b = sum(bases) / len(bases)
    ml = math.exp(b + modelo["h"] + modelo["fav"].get(loc, 0) - modelo["con"].get(vis, 0))
    mv = math.exp(b + modelo["fav"].get(vis, 0) - modelo["con"].get(loc, 0))
    return [round(ml, 3), round(mv, 3)]


# ---------------------------------------------------------------------------
# Programa principal
# ---------------------------------------------------------------------------
def main():
    print(f"Temporada {ANIO}/{ANIO + 1 - 2000:02d} · descargando datos…")
    hist, equipos_div = cargar_fd()
    print(f"  {len(hist)} partidos con datos de football-data.co.uk")
    calendario = cargar_calendario(equipos_div)
    print(f"  {len(calendario)} partidos en el calendario")

    # Fuerza a priori de cada equipo
    prior = {}
    for k, d in equipos_div.items():
        prior[k] = fuerza_div(d)
    for nombre, (pais, f) in SIN_LIGA.items():
        prior[f"{pais}:{nombre}"] = f
    for p in calendario:
        for k in (p["loc"], p["vis"]):
            prior.setdefault(k, FUERZA_DESCONOCIDA)

    # Índice para cruzar el calendario con football-data (resultados, estadísticas, cuotas)
    indice = {}
    for p in hist:
        indice.setdefault((p.loc, p.vis), []).append(p)

    def buscar(loc, vis, fecha, lista_indice):
        for p in lista_indice.get((loc, vis), []):
            if abs((p.fecha - fecha).days) <= 2:
                return p
        return None

    # Partidos europeos y partidos recientes aún no publicados en football-data -> solo goles
    for m in calendario:
        if m["res"] and not buscar(m["loc"], m["vis"], m["fecha"].date(), indice):
            p = Partido(fecha=m["fecha"].date(), div="UEFA" if not COMP[m["comp"]]["div"] else COMP[m["comp"]]["div"],
                        loc=m["loc"], vis=m["vis"], gl=m["res"][0], gv=m["res"][1], stats={}, cuotas={},
                        europeo=not COMP[m["comp"]]["div"])
            hist.append(p)
            indice.setdefault((p.loc, p.vis), []).append(p)
    hist.sort(key=lambda p: p.fecha)

    # Cuotas de los próximos partidos (football-data fixtures.csv)
    proximas = {}
    for r in leer_csv(descargar("https://www.football-data.co.uk/fixtures.csv", "fixtures.csv", 2)):
        if r.get("Div") not in DIVS:
            continue
        f = fecha_fd(r.get("Date", ""))
        pais = DIVS[r["Div"]][0]
        if f:
            proximas.setdefault((f"{pais}:{r['HomeTeam'].strip()}", f"{pais}:{r['AwayTeam'].strip()}"), []).append(
                (f, cuotas_de_fila(r, cierre=False), (r.get("Referee") or "").strip()))

    # Ajustes "paso a paso" (walk-forward): cada partido jugado se predice SOLO con datos anteriores
    inicio = min((m["fecha"].date() for m in calendario), default=HOY) - timedelta(days=1)
    cortes = []
    d = inicio
    while d < HOY:
        cortes.append(d)
        d += timedelta(days=7)
    cortes.append(HOY + timedelta(days=1))
    print(f"  Entrenando el modelo en {len(cortes)} fechas de corte (sin mirar el futuro)…")
    modelos = {}
    for corte in cortes:
        modelos[corte] = {
            "g": ajustar_goles(hist, prior, corte),
            **{k: ajustar_stat(hist, k, corte, equipos_div) for k in ("c", "f", "t", "tp")},
        }
    final = modelos[cortes[-1]]

    # Tabla de equipos
    temporada_inicio = inicio
    equipos = {}
    usados = {m["loc"] for m in calendario} | {m["vis"] for m in calendario}
    nombres_fx = {}
    for m in calendario:
        if COMP[m["comp"]]["div"]:
            nombres_fx.setdefault(m["loc"], m["nl"])
            nombres_fx.setdefault(m["vis"], m["nv"])
        else:
            nombres_fx.setdefault(m["loc"], m["nl"]); nombres_fx.setdefault(m["vis"], m["nv"])
    for t in usados:
        fd_nombre = t.split(":", 1)[1]
        nombre = NOMBRE_BONITO.get(fd_nombre) or nombres_fx.get(t) or fd_nombre
        jugados = [p for p in hist if (p.loc == t or p.vis == t) and p.fecha >= temporada_inicio]
        ultimos = [p for p in hist if (p.loc == t or p.vis == t)][-6:]
        forma = []
        for p in ultimos[::-1][:5]:
            gf, gc = (p.gl, p.gv) if p.loc == t else (p.gv, p.gl)
            rival = p.vis if p.loc == t else p.loc
            forma.append({"r": "G" if gf > gc else ("E" if gf == gc else "P"), "m": f"{int(gf)}-{int(gc)}",
                          "rival": NOMBRE_BONITO.get(rival.split(':', 1)[1], rival.split(':', 1)[1]),
                          "casa": p.loc == t, "f": p.fecha.isoformat()})
        est = {"pj": len(jugados)}
        if jugados:
            def media(fn):
                vals = [v for v in (fn(p) for p in jugados) if v is not None]
                return round(sum(vals) / len(vals), 2) if vals else None
            est["gf"] = media(lambda p: p.gl if p.loc == t else p.gv)
            est["gc"] = media(lambda p: p.gv if p.loc == t else p.gl)
            est["xgf"] = media(lambda p: (p.xl if p.loc == t else p.xv))
            est["xgc"] = media(lambda p: (p.xv if p.loc == t else p.xl))
            for k, (fa, co) in {"c": ("cf", "cc"), "f": ("ff", "fr"), "t": ("tf", "tr"), "tp": ("tpf", "tpc")}.items():
                est[fa] = media(lambda p: (p.stats[k][0] if p.loc == t else p.stats[k][1]) if k in p.stats else None)
                est[co] = media(lambda p: (p.stats[k][1] if p.loc == t else p.stats[k][0]) if k in p.stats else None)
            est["o25"] = media(lambda p: 1.0 if p.gl + p.gv > 2.5 else 0.0)
            est["btts"] = media(lambda p: 1.0 if p.gl > 0 and p.gv > 0 else 0.0)
        g = final["g"]
        equipos[t] = {
            "nombre": nombre, "pais": t.split(":")[0], "liga": equipos_div.get(t),
            "ataque": round(math.exp(g["att"].get(t, prior[t]) - 0), 3),
            "defensa": round(math.exp(g["dfn"].get(t, prior[t])), 3),
            "datos": round(g["n"].get(t, 0), 1),
            "forma": forma, "est": est,
        }

    # Partidos de salida
    salida = []
    for i, m in enumerate(sorted(calendario, key=lambda x: (x["fecha"], x["comp"]))):
        f = m["fecha"].date()
        corte = max([c for c in cortes if c <= f] or [cortes[0]])
        jugado = m["res"] is not None
        mod = modelos[corte] if (jugado or f < HOY) else final
        lh, la = lambdas(mod["g"], m["loc"], m["vis"], prior)
        modelo = {"g": [round(lh, 3), round(la, 3)]}
        for k in ("c", "f", "t", "tp"):
            v = medias_stat(mod[k], m["loc"], m["vis"], equipos_div)
            if v and m["loc"] in (mod[k] or {}).get("fav", {}) and m["vis"] in (mod[k] or {}).get("fav", {}):
                modelo[k] = v
            elif v:
                modelo[k] = v
                modelo.setdefault("aprox", []).append(k)
        n_min = min(mod["g"]["n"].get(m["loc"], 0), mod["g"]["n"].get(m["vis"], 0))
        modelo["fiab"] = round(min(1.0, n_min / 15.0), 2)
        rec = buscar(m["loc"], m["vis"], f, indice)
        item = {
            "id": f"{m['comp']}-{m['jornada']}-{i}", "comp": m["comp"], "j": m["jornada"],
            "fecha": m["fecha"].strftime("%Y-%m-%dT%H:%M:%SZ"), "l": m["loc"], "v": m["vis"],
            "estadio": m["estadio"], "modelo": modelo,
        }
        if jugado:
            item["res"] = m["res"]
            if rec:
                real = {k: [int(x) for x in v] for k, v in rec.stats.items()}
                if rec.xl is not None:
                    real["xg"] = [rec.xl, rec.xv]
                item["real"] = real
                if rec.cuotas:
                    item["cuotas"] = rec.cuotas
                    item["cierre"] = True
            if "cuotas" not in item:
                # aún no está en los resultados de football-data: usamos las cuotas previas al partido
                for (fp, cu, arb) in proximas.get((m["loc"], m["vis"]), []):
                    if abs((fp - f).days) <= 2 and cu:
                        item["cuotas"] = cu
                        break
        else:
            for (fp, cu, arb) in proximas.get((m["loc"], m["vis"]), []):
                if abs((fp - f).days) <= 2 and cu:
                    item["cuotas"] = cu
                    if arb:
                        item["arbitro"] = arb
                    break
            if "cuotas" not in item and rec and rec.cuotas and abs((rec.fecha - f).days) <= 2:
                # jugado según football-data pero aún sin marcador en el calendario
                item["cuotas"] = rec.cuotas
                item["cierre"] = True
        salida.append(item)

    # Dispersión de cada estadística (del modelo final)
    disp = {k: {"k": final[k]["k"], "ke": final[k]["ke"]} for k in ("c", "f", "t", "tp") if final[k]}

    comps = []
    ahora = datetime.now(timezone.utc)
    for comp in COMPETICIONES:
        ps = [p for p in calendario if p["comp"] == comp["id"]]
        if not ps:
            continue
        jornadas = sorted({p["jornada"] for p in ps})
        pend = [p for p in ps if p["res"] is None and p["fecha"] > ahora - timedelta(hours=3)]
        actual = min(pend, key=lambda p: p["fecha"])["jornada"] if pend else jornadas[-1]
        comps.append({"id": comp["id"], "nombre": comp["nombre"], "corto": comp["corto"],
                      "bandera": comp["bandera"], "jornadas": jornadas, "actual": actual,
                      "europea": not comp["div"]})

    out = {
        "generado": ahora.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "temporada": f"{ANIO}/{(ANIO + 1) % 100:02d}",
        "competiciones": comps, "equipos": equipos, "partidos": salida,
        "dispersion": disp, "rho": -0.06,
        "fuentes": ["fixturedownload.com (calendario)", "football-data.co.uk (resultados, estadísticas y cuotas)"],
    }
    os.makedirs(os.path.dirname(SALIDA), exist_ok=True)
    with open(SALIDA, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    con_cuotas = sum(1 for p in salida if "cuotas" in p and "res" not in p)
    print(f"  Listo: {SALIDA} · {len(salida)} partidos · {con_cuotas} próximos con cuotas · {len(equipos)} equipos")


COMP = {c["id"]: c for c in COMPETICIONES}

if __name__ == "__main__":
    main()
