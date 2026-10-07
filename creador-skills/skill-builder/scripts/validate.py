#!/usr/bin/env python3
"""Valida una skill de Claude (Agent Skill) y muestra un informe en español.

Uso:
    python3 validate.py RUTA_SKILL [--destino ambos|claude-code|claudeai] [--estricto]

Códigos de salida:
    0  sin errores bloqueantes (puede haber avisos)
    1  hay errores bloqueantes
    2  uso incorrecto (ruta inexistente, argumentos no válidos)

Solo usa la biblioteca estándar de Python 3.10+. No modifica ningún archivo.
Las reglas proceden de docs/especificacion-skills.md (consulta: 2026-10-07).
"""

from __future__ import annotations

import argparse
import ast
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

# --- Límites de la especificación oficial -----------------------------------
NOMBRE_MAX = 64                 # F1, F4
DESCRIPCION_MAX = 1024          # F1, F2, F4
DESCRIPCION_MAX_CLAUDEAI = 200  # F5 (centro de ayuda de claude.ai); contradice F1
DESCRIPCION_MIN_UTIL = 40       # Heurística propia: por debajo suele ser demasiado vaga
LISTADO_CLAUDE_CODE_MAX = 1536  # F3: description + when_to_use se truncan aquí
COMPATIBILIDAD_MAX = 500        # F3, F4
LINEAS_SKILL_MAX = 500          # F2, F3, F4: recomendación para el cuerpo
TOKENS_SKILL_MAX = 5000         # F1, F4: recomendación para el cuerpo
CARACTERES_POR_TOKEN = 4        # Estimación habitual para texto
LINEAS_REFERENCIA_CON_INDICE = 100  # F2: más de 100 líneas → tabla de contenidos
TAMANO_MAX_ESCANEO = 1_000_000  # No se escanean archivos de más de 1 MB

PALABRAS_RESERVADAS = ("anthropic", "claude")       # F1, F2
NOMBRES_RESERVADOS_CC = ("synced", "anthropic-skills")  # F3
NOMBRES_VAGOS = {"helper", "utils", "tools", "documents", "data", "files", "skill", "misc"}

CAMPOS_ESPEC = {"name", "description", "license", "compatibility", "metadata", "allowed-tools"}
CAMPOS_CLAUDE_CODE = {
    "when_to_use", "argument-hint", "arguments", "disable-model-invocation",
    "user-invocable", "disallowed-tools", "model", "effort", "context", "agent",
    "background", "hooks", "paths", "shell",
}
CAMPOS_NO_ESTANDAR = {"dependencies"}  # Solo en F5

DESTINOS = ("ambos", "claude-code", "claudeai")

# Carpetas y archivos que nunca forman parte de una skill distribuible.
EXCLUIR_CARPETAS = {"__pycache__", "node_modules", ".git", ".pytest_cache", ".mypy_cache", ".venv", "venv"}
EXCLUIR_ARCHIVOS = {".DS_Store", "Thumbs.db"}
EXCLUIR_SUFIJOS = (".pyc", ".pyo", ".tmp", ".bak", ".swp", "~")
CARPETAS_PRUEBAS = {"tests", "evals"}  # Solo en la raíz de la skill

PREFIJO_DIR_SKILL = "${CLAUDE_SKILL_DIR}/"
CARPETAS_RECURSOS = ("scripts/", "reference/", "references/", "assets/", "templates/", "tests/")
EXTENSIONES_SCRIPT = {".py", ".sh", ".bash", ".js", ".mjs", ".cjs"}

# --- Detección de secretos ----------------------------------------------------
PATRONES_SECRETOS = [
    ("clave de API de Anthropic", re.compile(r"sk-ant-[A-Za-z0-9_\-]{20,}")),
    ("clave de API tipo OpenAI", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9]{32,}")),
    ("clave de acceso de AWS", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("token de GitHub", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b")),
    ("token de GitHub (fine-grained)", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{50,}")),
    ("token de Slack", re.compile(r"\bxox[abprs]-[A-Za-z0-9\-]{10,}")),
    ("clave de API de Google", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")),
    ("clave secreta de Stripe", re.compile(r"\b[sr]k_live_[0-9A-Za-z]{20,}")),
    ("clave privada", re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----")),
    ("token JWT", re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}")),
    ("credenciales en una URL", re.compile(r"[a-z][a-z0-9+.\-]*://[^\s:/@]+:[^\s:/@]{6,}@[^\s/]+")),
]
PATRON_ASIGNACION = re.compile(
    r"""(?ix)
    \b(password|passwd|pwd|contrase(?:ñ|n)a|clave|secret|secreto|token|api[_\-]?key|apikey|access[_\-]?key|auth)\w*
    \s*[:=]\s*
    (["'])([^"'\s]{8,})\2
    """
)
INDICIOS_MARCADOR = (
    "xxx", "...", "example", "ejemplo", "tu_", "your_", "<", "{", "$", "changeme",
    "placeholder", "dummy", "fake", "falso", "aqui", "aquí", "redacted", "****", "env",
)
MARCA_IGNORAR = "validate: ignorar-secreto"


# =============================================================================
# Informe
# =============================================================================
@dataclass
class Hallazgo:
    tipo: str          # "error" | "aviso"
    mensaje: str
    solucion: str = ""
    archivo: str = ""
    linea: int | None = None

    def formatear(self) -> str:
        icono = "❌" if self.tipo == "error" else "⚠️ "
        lugar = ""
        if self.archivo:
            lugar = f" [{self.archivo}" + (f":{self.linea}" if self.linea else "") + "]"
        texto = f"{icono}{lugar} {self.mensaje}"
        if self.solucion:
            texto += f"\n      → Cómo solucionarlo: {self.solucion}"
        return texto


@dataclass
class Informe:
    ruta: Path
    nombre: str | None = None
    hallazgos: list[Hallazgo] = field(default_factory=list)
    frontmatter: dict = field(default_factory=dict)

    def error(self, mensaje, solucion="", archivo="", linea=None):
        self.hallazgos.append(Hallazgo("error", mensaje, solucion, archivo, linea))

    def aviso(self, mensaje, solucion="", archivo="", linea=None):
        self.hallazgos.append(Hallazgo("aviso", mensaje, solucion, archivo, linea))

    @property
    def errores(self):
        return [h for h in self.hallazgos if h.tipo == "error"]

    @property
    def avisos(self):
        return [h for h in self.hallazgos if h.tipo == "aviso"]

    @property
    def valido(self) -> bool:
        return not self.errores

    def texto(self) -> str:
        lineas = [f"Validación de la skill: {self.ruta}"]
        if self.nombre:
            lineas.append(f"Nombre: {self.nombre}")
        lineas.append("")
        if self.errores:
            lineas.append(f"ERRORES BLOQUEANTES ({len(self.errores)}):")
            lineas += ["  " + h.formatear() for h in self.errores]
            lineas.append("")
        if self.avisos:
            lineas.append(f"AVISOS – mejorables ({len(self.avisos)}):")
            lineas += ["  " + h.formatear() for h in self.avisos]
            lineas.append("")
        if self.valido:
            extra = " (con avisos)" if self.avisos else ""
            lineas.append(f"✅ Resultado: VÁLIDA{extra}")
        else:
            lineas.append("⛔ Resultado: NO VÁLIDA – corrige los errores bloqueantes y vuelve a validar.")
        return "\n".join(lineas)


# =============================================================================
# Utilidades de archivos (compartidas con package.py e install.py)
# =============================================================================
def debe_excluir(rel: Path, incluir_pruebas: bool = True) -> bool:
    """Indica si un archivo (ruta relativa a la skill) no debe distribuirse."""
    partes = rel.parts
    if any(p in EXCLUIR_CARPETAS for p in partes):
        return True
    if any(p.startswith(".") for p in partes):  # ocultos: .env, .git, .idea...
        return True
    if not incluir_pruebas and len(partes) > 1 and partes[0] in CARPETAS_PRUEBAS:
        return True
    nombre = rel.name
    return nombre in EXCLUIR_ARCHIVOS or nombre.endswith(EXCLUIR_SUFIJOS)


def archivos_de_skill(raiz: Path, incluir_pruebas: bool = True) -> list[Path]:
    """Lista ordenada de archivos de la skill (sin cachés ni ocultos). No sigue enlaces simbólicos a carpetas."""
    resultado = []
    for ruta in sorted(raiz.rglob("*")):
        if ruta.is_symlink() or not ruta.is_file():
            continue
        rel = ruta.relative_to(raiz)
        if not debe_excluir(rel, incluir_pruebas):
            resultado.append(ruta)
    return resultado


def leer_texto(ruta: Path) -> str | None:
    """Devuelve el contenido UTF-8 o None si el archivo es binario o demasiado grande."""
    try:
        if ruta.stat().st_size > TAMANO_MAX_ESCANEO:
            return None
        datos = ruta.read_bytes()
    except OSError:
        return None
    if b"\x00" in datos[:8192]:
        return None
    try:
        return datos.decode("utf-8")
    except UnicodeDecodeError:
        return None


# =============================================================================
# Analizador YAML mínimo para frontmatter (sin dependencias)
# =============================================================================
class ErrorYAML(Exception):
    def __init__(self, mensaje: str, linea: int):
        super().__init__(mensaje)
        self.linea = linea


_CLAVE = re.compile(r"^([A-Za-z0-9_][A-Za-z0-9_\-]*)\s*:(?:\s+(.*)|\s*)$")


def _escalar(valor: str, linea: int):
    """Convierte un escalar YAML de una línea en str/bool/int/float/None."""
    v = valor.strip()
    if v.startswith('"'):
        if len(v) < 2 or not v.endswith('"') or v.endswith('\\"') and not v.endswith('\\\\"'):
            raise ErrorYAML("comilla doble sin cerrar", linea)
        interior = v[1:-1]
        try:
            return bytes(interior, "utf-8").decode("unicode_escape").encode("latin-1").decode("utf-8")
        except (UnicodeDecodeError, UnicodeEncodeError):
            return interior.replace('\\"', '"').replace("\\\\", "\\")
    if v.startswith("'"):
        if len(v) < 2 or not v.endswith("'"):
            raise ErrorYAML("comilla simple sin cerrar", linea)
        return v[1:-1].replace("''", "'")
    # Comentario al final de un escalar plano
    v = re.split(r"\s+#", v, maxsplit=1)[0].rstrip()
    if v == "" or v in ("~", "null", "Null", "NULL"):
        return None
    if v in ("true", "True", "TRUE"):
        return True
    if v in ("false", "False", "FALSE"):
        return False
    if re.fullmatch(r"[-+]?\d+", v):
        return int(v)
    if re.fullmatch(r"[-+]?\d+\.\d+", v):
        return float(v)
    if v[0] in "[{":
        if v[0] == "[" and v.endswith("]"):
            return [_escalar(x, linea) for x in v[1:-1].split(",") if x.strip()]
        raise ErrorYAML("colecciones de flujo complejas no soportadas; usa una lista con guiones", linea)
    if v[0] in "&*!|>%@`":
        raise ErrorYAML(f"un valor sin comillas no puede empezar por '{v[0]}'", linea)
    if ": " in v or v.endswith(":"):
        raise ErrorYAML("el valor contiene ': ' sin comillas (YAML lo interpreta como otro mapa)", linea)
    return v


def analizar_yaml(texto: str, linea_inicial: int = 2) -> tuple[dict, dict]:
    """Analiza el subconjunto de YAML habitual en frontmatter.

    Admite: clave: valor, escalares entre comillas, bloques | y >, escalares planos
    de varias líneas, listas con guiones o [a, b] y un nivel de mapa anidado.
    Devuelve (datos, línea_de_cada_clave).
    """
    lineas = texto.split("\n")
    datos: dict = {}
    lineas_clave: dict = {}
    i = 0
    while i < len(lineas):
        bruta = lineas[i]
        num = linea_inicial + i
        if "\t" in bruta[: len(bruta) - len(bruta.lstrip())]:
            raise ErrorYAML("YAML no admite tabuladores para sangrar; usa espacios", num)
        if not bruta.strip() or bruta.lstrip().startswith("#"):
            i += 1
            continue
        if bruta[0] == " ":
            raise ErrorYAML("sangría inesperada (¿falta la clave de esta línea?)", num)
        m = _CLAVE.match(bruta)
        if not m:
            raise ErrorYAML(f"línea no válida: se esperaba 'clave: valor' y se encontró «{bruta.strip()[:60]}»", num)
        clave, valor = m.group(1), (m.group(2) or "").strip()
        if clave in datos:
            raise ErrorYAML(f"clave duplicada «{clave}»", num)
        lineas_clave[clave] = num
        # Recoger líneas de continuación (sangradas o vacías)
        j = i + 1
        bloque = []
        while j < len(lineas) and (lineas[j].strip() == "" or lineas[j].startswith((" ", "\t"))):
            if lineas[j].startswith("\t"):
                raise ErrorYAML("YAML no admite tabuladores para sangrar; usa espacios", linea_inicial + j)
            bloque.append(lineas[j])
            j += 1
        while bloque and not bloque[-1].strip():
            bloque.pop()
        datos[clave] = _valor_compuesto(valor, bloque, num)
        i = j
    return datos, lineas_clave


def _valor_compuesto(valor: str, bloque: list[str], num: int):
    contenido = [b for b in bloque if b.strip()]
    if valor[:1] in ("|", ">") and re.fullmatch(r"[|>][+-]?\d?", valor.split("#")[0].strip()):
        if not contenido:
            return ""
        sangria = min(len(b) - len(b.lstrip(" ")) for b in contenido)
        texto = [b[sangria:] if b.strip() else "" for b in bloque]
        if valor.startswith("|"):
            return "\n".join(texto).rstrip("\n") + ("" if valor.endswith("-") else "\n")
        parrafos, actual = [], []
        for t in texto:
            if t:
                actual.append(t.strip())
            else:
                parrafos.append(" ".join(actual))
                actual = []
        parrafos.append(" ".join(actual))
        return "\n".join(p for p in parrafos if p) + ("" if valor.endswith("-") else "\n")
    if valor == "":
        if not contenido:
            return None
        primera = contenido[0].strip()
        if primera.startswith("- ") or primera == "-":
            elementos = []
            for k, b in enumerate(contenido):
                s = b.strip()
                if not s.startswith("-"):
                    raise ErrorYAML("lista mal formada: cada elemento debe empezar por '- '", num + 1 + k)
                elementos.append(_escalar(s[1:].strip(), num + 1 + k))
            return elementos
        mapa = {}
        for k, b in enumerate(contenido):
            m = _CLAVE.match(b.strip())
            if not m:
                raise ErrorYAML("mapa anidado mal formado (se esperaba 'clave: valor')", num + 1 + k)
            mapa[m.group(1)] = _escalar(m.group(2) or "", num + 1 + k)
        return mapa
    # Escalar en la misma línea, quizá continuado en las siguientes
    if contenido:
        if valor[0] in "\"'" and not (len(valor) > 1 and valor.endswith(valor[0])):
            unido = valor + " " + " ".join(b.strip() for b in contenido)
            return _escalar(unido, num)
        unido = " ".join([valor] + [b.strip() for b in contenido])
        return _escalar(unido, num)
    return _escalar(valor, num)


def extraer_frontmatter(texto: str) -> tuple[str, str, int]:
    """Devuelve (yaml, cuerpo, línea donde empieza el cuerpo). Lanza ErrorYAML."""
    if texto.startswith("\ufeff"):
        texto = texto[1:]
    lineas = texto.split("\n")
    if not lineas or lineas[0].rstrip("\r") != "---":
        raise ErrorYAML("SKILL.md debe empezar con una línea '---' que abra el frontmatter YAML", 1)
    for k in range(1, len(lineas)):
        if lineas[k].rstrip("\r") == "---":
            yaml = "\n".join(l.rstrip("\r") for l in lineas[1:k])
            cuerpo = "\n".join(lineas[k + 1:])
            return yaml, cuerpo, k + 2
    raise ErrorYAML("no se encuentra la línea '---' que cierra el frontmatter", len(lineas))


# =============================================================================
# Comprobaciones
# =============================================================================
def _validar_nombre(inf: Informe, nombre, carpeta: str, linea):
    sol_formato = "usa solo minúsculas, números y guiones, p. ej. «procesando-facturas»."
    if nombre is None or (isinstance(nombre, str) and not nombre.strip()):
        inf.error("Falta el campo obligatorio 'name' o está vacío.",
                  f"añade 'name: {carpeta}' al frontmatter.", "SKILL.md", linea)
        return
    if not isinstance(nombre, str):
        inf.error(f"'name' debe ser texto y es {type(nombre).__name__}.",
                  "escribe el nombre como texto (entre comillas si es numérico).", "SKILL.md", linea)
        return
    inf.nombre = nombre
    if len(nombre) > NOMBRE_MAX:
        inf.error(f"'name' tiene {len(nombre)} caracteres; el máximo es {NOMBRE_MAX}.",
                  "acórtalo.", "SKILL.md", linea)
    if re.search(r"<[^>]*>", nombre):
        inf.error("'name' no puede contener etiquetas XML.", sol_formato, "SKILL.md", linea)
    if not re.fullmatch(r"[a-z0-9-]+", nombre):
        malos = "".join(sorted({c for c in nombre if not re.fullmatch(r"[a-z0-9-]", c)}))
        inf.error(f"'name' contiene caracteres no permitidos: «{malos}».", sol_formato, "SKILL.md", linea)
    if nombre.startswith("-") or nombre.endswith("-"):
        inf.error("'name' no puede empezar ni terminar con guion.", sol_formato, "SKILL.md", linea)
    if "--" in nombre:
        inf.error("'name' no puede contener dos guiones seguidos ('--').", sol_formato, "SKILL.md", linea)
    for palabra in PALABRAS_RESERVADAS:
        if palabra in nombre.lower():
            inf.error(f"'name' contiene la palabra reservada «{palabra}».",
                      "elige un nombre sin «anthropic» ni «claude».", "SKILL.md", linea)
    if nombre in NOMBRES_RESERVADOS_CC:
        inf.error(f"«{nombre}» es un nombre reservado en Claude Code.", "elige otro nombre.", "SKILL.md", linea)
    if nombre != carpeta:
        inf.error(f"El nombre de la carpeta («{carpeta}») no coincide con 'name' («{nombre}»).",
                  f"renombra la carpeta a «{nombre}» o cambia 'name' a «{carpeta}».", "SKILL.md", linea)
    if nombre in NOMBRES_VAGOS:
        inf.aviso(f"'name' («{nombre}») es demasiado genérico.",
                  "usa un nombre que describa la actividad, p. ej. en gerundio: «analizando-hojas-de-calculo».",
                  "SKILL.md", linea)


def _validar_descripcion(inf: Informe, desc, linea, cuando_usar, estricto: bool, destino: str):
    if desc is None or (isinstance(desc, str) and not desc.strip()):
        inf.error("Falta el campo obligatorio 'description' o está vacío.",
                  "añade una descripción que diga qué hace la skill y cuándo usarla.", "SKILL.md", linea)
        return
    if not isinstance(desc, str):
        inf.error(f"'description' debe ser texto y es {type(desc).__name__}.",
                  "escríbela como texto entre comillas.", "SKILL.md", linea)
        return
    d = desc.strip()
    if len(d) > DESCRIPCION_MAX:
        inf.error(f"'description' tiene {len(d)} caracteres; el máximo es {DESCRIPCION_MAX}.",
                  f"recórtala en {len(d) - DESCRIPCION_MAX} caracteres; mueve los detalles al cuerpo de SKILL.md.",
                  "SKILL.md", linea)
    elif len(d) > DESCRIPCION_MAX_CLAUDEAI and destino != "claude-code":
        mensaje = (f"'description' tiene {len(d)} caracteres; el centro de ayuda de claude.ai indica un máximo "
                   f"de {DESCRIPCION_MAX_CLAUDEAI} (la especificación permite {DESCRIPCION_MAX}).")
        solucion = "si claude.ai rechaza el paquete, acórtala a 200 caracteres manteniendo qué hace y cuándo usarla."
        (inf.error if estricto else inf.aviso)(mensaje, solucion, "SKILL.md", linea)
    if "<" in d or ">" in d:
        inf.error("'description' no puede contener '<' ni '>' (etiquetas XML).",
                  "elimina esos caracteres o sustitúyelos por palabras.", "SKILL.md", linea)
    if len(d) < DESCRIPCION_MIN_UTIL:
        inf.aviso(f"'description' es muy corta ({len(d)} caracteres) y probablemente demasiado vaga.",
                  "explica qué hace y en qué situaciones usarla, con las palabras que usaría el usuario.",
                  "SKILL.md", linea)
    baja = d.lower()
    if not re.search(r"\b(cuando|cuándo|úsala|usala|usar|úsalo|use when|when|whenever|si el usuario|para)\b", baja):
        inf.aviso("'description' no parece indicar cuándo usar la skill.",
                  "añade una frase como «Usar cuando el usuario pida…» con ejemplos de peticiones.",
                  "SKILL.md", linea)
    if re.search(r"\b(puedo|te ayudo|te ayudaré|puedes usar|i can|you can|i will|i'll)\b", baja):
        inf.aviso("'description' no está en tercera persona.",
                  "redáctala en tercera persona: «Genera…», «Analiza…», no «Puedo…» ni «Puedes…».",
                  "SKILL.md", linea)
    total = len(d) + len(str(cuando_usar or ""))
    if cuando_usar and total > LISTADO_CLAUDE_CODE_MAX:
        inf.error(f"'description' + 'when_to_use' suman {total} caracteres; Claude Code los trunca a "
                  f"{LISTADO_CLAUDE_CODE_MAX}.", "reduce 'when_to_use'.", "SKILL.md", linea)


def _validar_campos(inf: Informe, fm: dict, lineas: dict, destino: str):
    for clave in fm:
        lin = lineas.get(clave)
        if clave in CAMPOS_ESPEC:
            continue
        if clave in CAMPOS_CLAUDE_CODE:
            if destino == "claude-code":
                continue
            inf.error(f"El campo '{clave}' solo existe en Claude Code; el empaquetador oficial para claude.ai lo rechaza.",
                      "elimínalo o valida con '--destino claude-code' si la skill es solo para Claude Code.",
                      "SKILL.md", lin)
        elif clave in CAMPOS_NO_ESTANDAR:
            inf.aviso(f"El campo '{clave}' no forma parte de la especificación (solo lo menciona el centro de ayuda de claude.ai).",
                      "indica las dependencias en el cuerpo de SKILL.md o en 'compatibility'.", "SKILL.md", lin)
        else:
            parecido = [c for c in sorted(CAMPOS_ESPEC | CAMPOS_CLAUDE_CODE)
                        if c.replace("_", "-") == clave.lower().replace("_", "-")]
            pista = f" ¿Querías decir '{parecido[0]}'?" if parecido else ""
            inf.error(f"Campo desconocido en el frontmatter: '{clave}'.{pista}",
                      "permitidos: " + ", ".join(sorted(CAMPOS_ESPEC)) + " (más los de Claude Code si el destino es solo Claude Code).",
                      "SKILL.md", lin)
    comp = fm.get("compatibility")
    if comp is not None:
        if not isinstance(comp, str) or not comp.strip():
            inf.error("'compatibility' debe ser un texto no vacío.", "", "SKILL.md", lineas.get("compatibility"))
        elif len(comp) > COMPATIBILIDAD_MAX:
            inf.error(f"'compatibility' tiene {len(comp)} caracteres; el máximo es {COMPATIBILIDAD_MAX}.",
                      "resúmela.", "SKILL.md", lineas.get("compatibility"))
    meta = fm.get("metadata")
    if meta is not None:
        if not isinstance(meta, dict):
            inf.error("'metadata' debe ser un mapa clave: valor.", "", "SKILL.md", lineas.get("metadata"))
        elif any(not isinstance(v, str) for v in meta.values()):
            inf.aviso("Los valores de 'metadata' deberían ser texto (p. ej. version: \"1.0\").",
                      "pon los números entre comillas.", "SKILL.md", lineas.get("metadata"))
    for clave in ("disable-model-invocation", "user-invocable", "background"):
        if clave in fm and not isinstance(fm[clave], bool):
            inf.error(f"'{clave}' debe ser true o false.", "", "SKILL.md", lineas.get(clave))


def _enlaces(cuerpo: str, linea_inicio: int):
    """Genera (ruta, línea, es_enlace_markdown) de los archivos referenciados en Markdown."""
    en_bloque = False
    for k, linea in enumerate(cuerpo.split("\n")):
        num = linea_inicio + k
        if linea.lstrip().startswith("```"):
            en_bloque = not en_bloque
        for m in re.finditer(r"!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)", linea):
            if not en_bloque:
                yield m.group(1), num, True
        for m in re.finditer(r"(?<![\w/.\-])(?:\$\{CLAUDE_SKILL_DIR\}/)?(?:scripts|references?|assets|templates|tests)/[\w./\-]+", linea):
            yield m.group(0), num, False


def _normalizar_ruta(ruta: str) -> str | None:
    """Devuelve la ruta relativa a comprobar o None si no es un archivo local."""
    if re.match(r"^[a-z][a-z0-9+.\-]*:", ruta, re.I) or ruta.startswith(("#", "/", "~")):
        return None
    if ruta.startswith(PREFIJO_DIR_SKILL):
        ruta = ruta[len(PREFIJO_DIR_SKILL):]
    elif "$" in ruta or "{" in ruta or "*" in ruta or "<" in ruta:
        return None
    ruta = ruta.split("#")[0].split("?")[0].rstrip(".,;:")
    return ruta or None


def _validar_enlaces(inf: Informe, raiz: Path, cuerpo: str, linea_cuerpo: int):
    vistos = set()
    md_enlazados = []
    for ruta, num, es_md in _enlaces(cuerpo, linea_cuerpo):
        if "\\" in ruta:
            inf.aviso(f"Ruta con barra invertida: «{ruta}».", "usa siempre barras normales '/'.", "SKILL.md", num)
            continue
        rel = _normalizar_ruta(ruta)
        if rel is None or (rel, num) in vistos:
            continue
        vistos.add((rel, num))
        if not es_md and not Path(rel).suffix and not rel.endswith("/"):
            continue  # p. ej. "scripts/" mencionado como carpeta en el texto
        destino = (raiz / rel).resolve()
        try:
            destino.relative_to(raiz.resolve())
        except ValueError:
            inf.error(f"El enlace «{ruta}» apunta fuera de la carpeta de la skill.",
                      "incluye el archivo dentro de la skill y enlázalo con una ruta relativa.", "SKILL.md", num)
            continue
        if not destino.exists():
            linea_txt = cuerpo.split("\n")[num - linea_cuerpo]
            ejecuta = re.search(r"\b(python3?|bash|sh|node|uv run)\s+\S*" + re.escape(ruta), linea_txt)
            if es_md or ejecuta:
                inf.error(f"El archivo {'enlazado' if es_md else 'que se ejecuta'} «{rel}» no existe.",
                          "crea el archivo o corrige la ruta (relativa a la carpeta de la skill).", "SKILL.md", num)
            else:
                inf.aviso(f"Se menciona «{rel}», pero no existe en la skill.",
                          "si es un archivo de la skill, créalo; si es un ejemplo, ignora este aviso.", "SKILL.md", num)
        elif destino.suffix == ".md" and es_md and destino.parts[-2:-1] not in (("templates",), ("assets",)):
            md_enlazados.append(destino)
    for md in sorted(set(md_enlazados)):
        texto = leer_texto(md) or ""
        rel = md.relative_to(raiz.resolve()).as_posix()
        n_lineas = texto.count("\n") + 1
        if n_lineas > LINEAS_REFERENCIA_CON_INDICE and not re.search(
                r"(?im)^#+\s*(contenido|contenidos|índice|indice|tabla de contenidos|contents|table of contents)\b", texto):
            inf.aviso(f"«{rel}» tiene {n_lineas} líneas y no tiene tabla de contenidos.",
                      "añade al principio una sección «## Contenido» con la lista de apartados.", rel)
        for ruta, num, es_md in _enlaces(texto, 1):
            r = _normalizar_ruta(ruta)
            if es_md and r and r.endswith(".md"):
                inf.aviso(f"«{rel}» enlaza a su vez a «{r}» (referencias anidadas).",
                          "enlaza todos los archivos de referencia directamente desde SKILL.md (un solo nivel).",
                          rel, num)
                break


def _es_marcador(valor: str) -> bool:
    v = valor.lower()
    return any(ind in v for ind in INDICIOS_MARCADOR) or len(set(v)) <= 3


def _validar_secretos(inf: Informe, raiz: Path, archivos: list[Path]):
    for ruta in archivos:
        texto = leer_texto(ruta)
        if texto is None:
            continue
        rel = ruta.relative_to(raiz).as_posix()
        for num, linea in enumerate(texto.split("\n"), 1):
            if MARCA_IGNORAR in linea:
                continue
            for descripcion, patron in PATRONES_SECRETOS:
                if patron.search(linea):
                    inf.error(f"Posible {descripcion} expuesta.",
                              "elimínala del archivo, revócala si es real y léela de una variable de entorno.",
                              rel, num)
                    break
            else:
                m = PATRON_ASIGNACION.search(linea)
                if m and not _es_marcador(m.group(3)):
                    inf.error(f"Posible secreto asignado a «{m.group(1)}».",
                              "no guardes contraseñas ni tokens en la skill; usa variables de entorno.", rel, num)


def _validar_scripts(inf: Informe, raiz: Path, archivos: list[Path]):
    for ruta in archivos:
        ext = ruta.suffix.lower()
        if ext not in EXTENSIONES_SCRIPT:
            continue
        rel = ruta.relative_to(raiz).as_posix()
        if ext == ".py":
            try:
                ast.parse(ruta.read_text(encoding="utf-8"), filename=rel)
            except SyntaxError as e:
                inf.error(f"Error de sintaxis en Python: {e.msg}.", "corrige la línea indicada.", rel, e.lineno)
            except (UnicodeDecodeError, ValueError) as e:
                inf.error(f"No se puede leer el script como UTF-8: {e}.", "guárdalo en UTF-8.", rel)
        else:
            herramienta = shutil.which("bash") if ext in (".sh", ".bash") else shutil.which("node")
            if not herramienta:
                inf.aviso(f"No se ha podido comprobar la sintaxis (falta {'bash' if ext in ('.sh', '.bash') else 'node'}).",
                          "instálalo o revisa el script manualmente.", rel)
                continue
            orden = [herramienta, "-n", str(ruta)] if "bash" in herramienta else [herramienta, "--check", str(ruta)]
            try:
                res = subprocess.run(orden, capture_output=True, text=True, timeout=30)
            except (OSError, subprocess.TimeoutExpired) as e:
                inf.aviso(f"No se ha podido comprobar la sintaxis: {e}.", "", rel)
                continue
            if res.returncode != 0:
                detalle = (res.stderr or res.stdout).strip().splitlines()
                m = re.search(r"line (\d+)|:(\d+)", detalle[0] if detalle else "")
                linea = int(m.group(1) or m.group(2)) if m else None
                inf.error(f"Error de sintaxis: {detalle[0] if detalle else 'desconocido'}.", "corrige el script.", rel, linea)


def _validar_cuerpo(inf: Informe, cuerpo: str, linea_cuerpo: int):
    if not cuerpo.strip():
        inf.error("El cuerpo de SKILL.md está vacío.", "añade las instrucciones tras el frontmatter.", "SKILL.md", linea_cuerpo)
        return
    n_lineas = len(cuerpo.strip("\n").split("\n"))
    if n_lineas > LINEAS_SKILL_MAX:
        inf.aviso(f"El cuerpo de SKILL.md tiene {n_lineas} líneas (recomendado: menos de {LINEAS_SKILL_MAX}).",
                  "mueve detalles, ejemplos largos o tablas a archivos de reference/ y enlázalos indicando cuándo leerlos.",
                  "SKILL.md")
    tokens = len(cuerpo) // CARACTERES_POR_TOKEN
    if tokens > TOKENS_SKILL_MAX:
        inf.aviso(f"El cuerpo de SKILL.md ocupa unos {tokens} tokens (recomendado: menos de {TOKENS_SKILL_MAX}).",
                  "aplica la carga progresiva: deja en SKILL.md solo el flujo principal.", "SKILL.md")


def validar_skill(ruta: Path | str, destino: str = "ambos", estricto: bool = False) -> Informe:
    """Valida la skill en `ruta` y devuelve un Informe. No modifica archivos."""
    raiz = Path(ruta).expanduser().resolve()
    inf = Informe(raiz)
    if not raiz.is_dir():
        inf.error(f"La carpeta «{raiz}» no existe o no es una carpeta.", "indica la ruta de la carpeta de la skill.")
        return inf
    skill_md = raiz / "SKILL.md"
    if not skill_md.is_file():
        alternativa = [p.name for p in raiz.iterdir() if p.name.lower() == "skill.md"]
        sol = (f"renombra «{alternativa[0]}» a «SKILL.md» (en mayúsculas)." if alternativa
               else "crea SKILL.md con frontmatter (name, description) e instrucciones.")
        inf.error("No existe el archivo SKILL.md.", sol)
        return inf

    texto = leer_texto(skill_md)
    if texto is None:
        inf.error("SKILL.md no está en UTF-8 o es binario.", "guárdalo como texto UTF-8.", "SKILL.md")
        return inf
    try:
        yaml, cuerpo, linea_cuerpo = extraer_frontmatter(texto)
        fm, lineas = analizar_yaml(yaml)
    except ErrorYAML as e:
        inf.error(f"Frontmatter YAML no válido: {e}.",
                  "revisa la sintaxis; pon entre comillas los valores que contengan ':' o empiecen por símbolos.",
                  "SKILL.md", e.linea)
        return inf
    inf.frontmatter = fm

    _validar_nombre(inf, fm.get("name"), raiz.name, lineas.get("name"))
    _validar_descripcion(inf, fm.get("description"), lineas.get("description"),
                         fm.get("when_to_use"), estricto, destino)
    _validar_campos(inf, fm, lineas, destino)
    _validar_cuerpo(inf, cuerpo, linea_cuerpo)
    _validar_enlaces(inf, raiz, cuerpo, linea_cuerpo)

    archivos = archivos_de_skill(raiz)
    if destino != "claude-code":
        extra = [p.relative_to(raiz).as_posix() for p in archivos
                 if p.name == "SKILL.md" and p != skill_md and not debe_excluir(p.relative_to(raiz), False)]
        if extra:
            inf.error(f"Hay varios SKILL.md ({', '.join(extra)}); claude.ai solo admite uno por skill.",
                      "renombra los demás (p. ej. reference/guia.md) o empaquétalos como skills separadas.")
    _validar_secretos(inf, raiz, archivos)
    _validar_scripts(inf, raiz, archivos)
    return inf


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Valida una skill de Claude y muestra errores y avisos.")
    parser.add_argument("ruta", help="carpeta de la skill (la que contiene SKILL.md)")
    parser.add_argument("--destino", choices=DESTINOS, default="ambos",
                        help="dónde se usará la skill (por defecto: ambos)")
    parser.add_argument("--estricto", action="store_true",
                        help="trata como error el límite de 200 caracteres de claude.ai")
    args = parser.parse_args(argv)
    if not Path(args.ruta).expanduser().is_dir():
        print(f"❌ La carpeta «{args.ruta}» no existe. Indica la carpeta que contiene SKILL.md.", file=sys.stderr)
        return 2
    informe = validar_skill(args.ruta, args.destino, args.estricto)
    print(informe.texto())
    return 0 if informe.valido else 1


if __name__ == "__main__":
    sys.exit(main())
