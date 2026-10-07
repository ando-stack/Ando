#!/usr/bin/env python3
"""Prueba si la descripción de una skill hace que Claude la active cuando debe.

Uso:
    python3 test_triggers.py RUTA_SKILL [--archivo tests/activacion.json] [--paralelo 3]
                             [--timeout 120] [--modelo MODELO] [--manual]

Lee tests/activacion.json (ver formato abajo). Si la CLI de Claude Code (`claude`) está
disponible, ejecuta cada petición con `claude -p … --output-format stream-json --verbose`
en una carpeta temporal donde la skill se copia en .claude/skills/<nombre>/ y comprueba
si Claude invoca la herramienta `Skill` con esa skill. Si la CLI no está disponible o la
detección no es fiable (p. ej. la skill no aparece en la lista de skills cargadas), genera
un checklist de pruebas manuales en tests/checklist-activacion.md.

Formato de tests/activacion.json:
    {
      "casos": [
        {"peticion": "texto que escribiría el usuario", "debe_activarse": true},
        {"peticion": "otra petición parecida pero fuera de alcance", "debe_activarse": false,
         "nota": "opcional: por qué"}
      ]
    }

Notas:
- Cada petición consume uso de tu cuenta de Claude. La carpeta temporal se borra al final.
- La decisión se toma con la primera herramienta que use Claude: si es la skill, se
  considera activada; si es otra herramienta o responde sin herramientas, no activada.
- Los resultados de un modelo de lenguaje no son deterministas: repite las pruebas
  dudosas con --repeticiones.

Códigos de salida: 0 todo correcto, 1 hay fallos, 2 uso incorrecto, 3 se generó checklist manual.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate import archivos_de_skill, validar_skill  # noqa: E402

# Una petición normal tarda 10–60 s; 120 s deja margen para respuestas lentas.
TIMEOUT_POR_DEFECTO = 120
# 3 procesos simultáneos equilibra rapidez y límites de uso de la cuenta.
PARALELO_POR_DEFECTO = 3
ACTIVADA, NO_ACTIVADA, INDETERMINADO = "activada", "no activada", "indeterminado"


# -----------------------------------------------------------------------------
def cargar_casos(ruta: Path) -> list[dict]:
    try:
        datos = json.loads(ruta.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ValueError(f"no existe {ruta}. Créalo con el formato descrito en la ayuda (--help).")
    except json.JSONDecodeError as e:
        raise ValueError(f"{ruta}:{e.lineno}: JSON no válido ({e.msg}).")
    casos = datos.get("casos") if isinstance(datos, dict) else None
    if not isinstance(casos, list) or not casos:
        raise ValueError(f"{ruta}: debe contener una lista no vacía en la clave \"casos\".")
    for i, caso in enumerate(casos, 1):
        if not isinstance(caso, dict) or not isinstance(caso.get("peticion"), str) or not caso["peticion"].strip():
            raise ValueError(f"{ruta}: el caso {i} necesita un texto en \"peticion\".")
        if not isinstance(caso.get("debe_activarse"), bool):
            raise ValueError(f"{ruta}: el caso {i} necesita \"debe_activarse\": true o false.")
    positivos = sum(c["debe_activarse"] for c in casos)
    if positivos == 0 or positivos == len(casos):
        print("⚠️  Conviene incluir casos que deben activarse Y casos que no deben activarse.")
    return casos


def preparar_proyecto(origen: Path, nombre: str) -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="prueba-activacion-"))
    destino = tmp / ".claude" / "skills" / nombre
    for archivo in archivos_de_skill(origen, incluir_pruebas=False):
        rel = archivo.relative_to(origen)
        (destino / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(archivo, destino / rel)
    return tmp


def ejecutar_peticion(peticion: str, nombre: str, proyecto: Path, timeout: int, modelo: str | None) -> tuple[str, str]:
    """Devuelve (resultado, detalle)."""
    orden = ["claude", "-p", peticion, "--output-format", "stream-json", "--verbose"]
    if modelo:
        orden += ["--model", modelo]
    # CLAUDECODE impide anidar la CLI dentro de otra sesión de Claude Code.
    entorno = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    try:
        proc = subprocess.Popen(orden, cwd=proyecto, env=entorno, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    except OSError as e:
        return INDETERMINADO, f"no se pudo ejecutar claude: {e}"
    # Vigilante: si la CLI se queda sin responder, se detiene el proceso al agotar el tiempo.
    vigilante = threading.Timer(timeout, proc.kill)
    vigilante.start()
    otras_lineas: list[str] = []  # salida no JSON (mensajes de error de la CLI)
    try:
        for linea in proc.stdout:
            try:
                evento = json.loads(linea)
            except json.JSONDecodeError:
                if linea.strip():
                    otras_lineas.append(linea.strip())
                continue
            tipo = evento.get("type")
            if tipo == "system" and evento.get("subtype") == "init":
                if nombre not in (evento.get("skills") or []):
                    return INDETERMINADO, "la skill no aparece entre las skills cargadas por Claude Code"
            elif tipo == "assistant":
                for bloque in evento.get("message", {}).get("content", []):
                    if bloque.get("type") != "tool_use":
                        continue
                    herramienta = bloque.get("name", "")
                    entrada = bloque.get("input", {}) or {}
                    if herramienta == "Skill":
                        usada = str(entrada.get("skill", ""))
                        if usada == nombre or usada.endswith(":" + nombre):
                            return ACTIVADA, "invocó la herramienta Skill"
                        return NO_ACTIVADA, f"invocó otra skill ({usada})"
                    if herramienta == "Read" and f"/{nombre}/SKILL.md" in str(entrada.get("file_path", "")):
                        return ACTIVADA, "leyó su SKILL.md"
                    return NO_ACTIVADA, f"usó primero la herramienta {herramienta}"
            elif tipo == "result":
                if evento.get("is_error"):
                    return INDETERMINADO, f"error de la CLI: {str(evento.get('result', ''))[:120]}"
                return NO_ACTIVADA, "respondió sin usar la skill"
        if not vigilante.is_alive():
            return INDETERMINADO, f"tiempo agotado ({timeout} s)"
        return INDETERMINADO, "la CLI terminó sin resultado" + (f": {otras_lineas[-1][:120]}" if otras_lineas else "")
    finally:
        vigilante.cancel()
        if proc.poll() is None:
            proc.kill()
        proc.wait()


# -----------------------------------------------------------------------------
def escribir_checklist(raiz: Path, nombre: str, casos: list[dict], motivo: str) -> Path:
    salida = raiz / "tests" / "checklist-activacion.md"
    salida.parent.mkdir(parents=True, exist_ok=True)
    lineas = [
        f"# Checklist de pruebas de activación: {nombre}", "",
        f"Motivo de la prueba manual: {motivo}", "",
        "## Cómo probar", "",
        f"1. Instala la skill (`install.py … --ambito personal`) o súbela a claude.ai.",
        "2. Abre una conversación NUEVA para cada petición (el contexto previo influye).",
        f"3. Escribe la petición tal cual y observa si Claude usa la skill «{nombre}»",
        "   (en Claude Code aparece una llamada a la herramienta `Skill`; en claude.ai, la skill",
        "   se muestra en el razonamiento o en los pasos de la respuesta).",
        "4. Marca la casilla si el comportamiento coincide con lo esperado.", "",
        "## Casos", "",
    ]
    for i, caso in enumerate(casos, 1):
        esperado = "DEBE activarse" if caso["debe_activarse"] else "NO debe activarse"
        nota = f" — {caso['nota']}" if caso.get("nota") else ""
        lineas.append(f"- [ ] {i}. ({esperado}) «{caso['peticion']}»{nota}")
    lineas += ["", "## Si algo falla", "",
               "- No se activa cuando debería: añade a la descripción las palabras de esa petición.",
               "- Se activa cuando no debería: concreta el alcance y añade «No usar para …».", ""]
    salida.write_text("\n".join(lineas), encoding="utf-8")
    return salida


def sugerencias(fallos_neg: list[dict], fallos_pos: list[dict]) -> list[str]:
    s = []
    if fallos_neg:
        s.append("La skill NO se activó en peticiones donde debía. Incorpora a la descripción los términos que "
                 "usan esas peticiones (verbos, objetos, formatos de archivo) y una frase «Usar cuando…». "
                 "Claude tiende a infra-activar skills: una descripción algo más insistente ayuda.")
        for c in fallos_neg:
            s.append(f"   · Términos a cubrir: «{c['peticion']}»")
    if fallos_pos:
        s.append("La skill se activó en peticiones fuera de su alcance. Haz la descripción más específica "
                 "(qué tipo de archivo, qué resultado) y añade «No usar para …» con esos casos.")
        for c in fallos_pos:
            s.append(f"   · Excluir: «{c['peticion']}»")
    return s


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Prueba la activación de una skill con la CLI de Claude Code.")
    parser.add_argument("ruta", help="carpeta de la skill")
    parser.add_argument("--archivo", default="tests/activacion.json",
                        help="archivo de casos, relativo a la skill (por defecto: tests/activacion.json)")
    parser.add_argument("--paralelo", type=int, default=PARALELO_POR_DEFECTO, help="peticiones simultáneas")
    parser.add_argument("--timeout", type=int, default=TIMEOUT_POR_DEFECTO, help="segundos máximos por petición")
    parser.add_argument("--repeticiones", type=int, default=1,
                        help="veces que se ejecuta cada petición; cuenta la mayoría")
    parser.add_argument("--modelo", help="modelo para `claude -p` (por defecto, el configurado)")
    parser.add_argument("--manual", action="store_true", help="no ejecuta la CLI; solo genera el checklist manual")
    args = parser.parse_args(argv)

    raiz = Path(args.ruta).expanduser().resolve()
    if not raiz.is_dir():
        print(f"❌ La carpeta «{args.ruta}» no existe.", file=sys.stderr)
        return 2
    informe = validar_skill(raiz, destino="claude-code")
    if not informe.valido:
        print(informe.texto())
        print("\n⛔ Corrige los errores de validación antes de probar la activación.")
        return 1
    nombre = informe.nombre
    archivo = Path(args.archivo) if Path(args.archivo).is_absolute() else raiz / args.archivo
    try:
        casos = cargar_casos(archivo)
    except ValueError as e:
        print(f"❌ {e}", file=sys.stderr)
        return 2

    if args.manual or not shutil.which("claude"):
        motivo = ("se pidió con --manual" if args.manual
                  else "la CLI de Claude Code (`claude`) no está instalada o no está en el PATH")
        ruta = escribir_checklist(raiz, nombre, casos, motivo)
        print(f"📝 Pruebas automáticas no disponibles: {motivo}.\n   Checklist manual generado en {ruta}")
        return 3

    print(f"🧪 Probando la activación de «{nombre}» con {len(casos)} casos "
          f"× {args.repeticiones} repetición(es) (paralelo: {args.paralelo})…\n")
    proyecto = preparar_proyecto(raiz, nombre)
    try:
        trabajos = [(i, c) for i, c in enumerate(casos) for _ in range(max(1, args.repeticiones))]
        with ThreadPoolExecutor(max_workers=max(1, args.paralelo)) as ex:
            res = list(ex.map(lambda t: (t[0], ejecutar_peticion(t[1]["peticion"], nombre, proyecto,
                                                                 args.timeout, args.modelo)), trabajos))
    finally:
        shutil.rmtree(proyecto, ignore_errors=True)

    aciertos, fallos_neg, fallos_pos, indeterminados = 0, [], [], []
    for i, caso in enumerate(casos):
        propios = [r for j, r in res if j == i]
        validos = [r for r in propios if r[0] != INDETERMINADO]
        if not validos:
            indeterminados.append((caso, propios[0][1]))
            print(f"❔ [{'debe' if caso['debe_activarse'] else 'no debe'}] «{caso['peticion']}» → indeterminado ({propios[0][1]})")
            continue
        activadas = sum(r[0] == ACTIVADA for r in validos)
        activada = activadas * 2 > len(validos)
        ok = activada == caso["debe_activarse"]
        aciertos += ok
        if not ok:
            (fallos_neg if caso["debe_activarse"] else fallos_pos).append(caso)
        icono = "✅" if ok else "❌"
        detalle = validos[0][1] if len(validos) == 1 else f"activada {activadas}/{len(validos)}"
        print(f"{icono} [{'debe' if caso['debe_activarse'] else 'no debe'}] «{caso['peticion']}» → "
              f"{'activada' if activada else 'no activada'} ({detalle})")

    evaluados = len(casos) - len(indeterminados)
    print(f"\nResultado: {aciertos}/{evaluados} aciertos · {len(fallos_neg)} sin activar cuando debía · "
          f"{len(fallos_pos)} activada sin deber · {len(indeterminados)} indeterminados")
    for linea in sugerencias(fallos_neg, fallos_pos):
        print("💡 " + linea if not linea.startswith("   ") else linea)

    if evaluados == 0:
        ruta = escribir_checklist(raiz, nombre, casos, "la detección automática no fue fiable: "
                                  + indeterminados[0][1])
        print(f"\n📝 No se pudo detectar el uso de la skill de forma fiable. Checklist manual en {ruta}")
        return 3
    if indeterminados:
        print("⚠️  Hay casos indeterminados: repítelos o pruébalos a mano (--manual genera el checklist).")
    return 0 if not fallos_neg and not fallos_pos and not indeterminados else 1


if __name__ == "__main__":
    sys.exit(main())
