#!/usr/bin/env python3
"""Pruebas de los scripts del creador de skills (validate, package, install, test_triggers).

Uso (desde la carpeta creador-skills):
    python3 -m unittest pruebas/test_scripts.py -v

Todas las skills de prueba se crean en carpetas temporales que se borran al terminar.
Las claves "expuestas" de las pruebas se construyen por partes en tiempo de ejecución
para que este archivo no contenga ningún secreto con formato real.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
import zipfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "skill-builder" / "scripts"
DESC_OK = "Resume archivos de prueba en una tabla. Usar cuando el usuario pida resumir un archivo de prueba."


def ejecutar(script: str, *args, env=None, cwd=None, entrada=None):
    return subprocess.run([sys.executable, str(SCRIPTS / script), *map(str, args)],
                          capture_output=True, text=True, env=env, cwd=cwd, input=entrada, timeout=120)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="pruebas-creador-"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def skill(self, nombre="resumiendo-pruebas", frontmatter=None, cuerpo="# Prueba\n\nHaz la prueba.\n",
              archivos=None, carpeta=None) -> Path:
        raiz = self.tmp / (carpeta or nombre)
        raiz.mkdir(parents=True, exist_ok=True)
        fm = frontmatter if frontmatter is not None else f"name: {nombre}\ndescription: {DESC_OK}\n"
        (raiz / "SKILL.md").write_text(f"---\n{fm}---\n\n{cuerpo}", encoding="utf-8")
        for rel, contenido in (archivos or {}).items():
            (raiz / rel).parent.mkdir(parents=True, exist_ok=True)
            (raiz / rel).write_text(contenido, encoding="utf-8")
        return raiz

    def validar(self, ruta, *extra):
        return ejecutar("validate.py", ruta, *extra)

    def assertError(self, res, fragmento):
        self.assertEqual(res.returncode, 1, res.stdout)
        self.assertIn(fragmento, res.stdout)

    def assertValida(self, res):
        self.assertEqual(res.returncode, 0, res.stdout)
        self.assertIn("VÁLIDA", res.stdout)


# =============================================================================
class TestValidate(Base):
    def test_skill_valida(self):
        res = self.validar(self.skill())
        self.assertValida(res)
        self.assertNotIn("⚠️", res.stdout)

    def test_sin_skill_md(self):
        raiz = self.tmp / "vacia"
        raiz.mkdir()
        self.assertError(self.validar(raiz), "No existe el archivo SKILL.md")

    def test_skill_md_en_minusculas(self):
        raiz = self.skill()
        (raiz / "SKILL.md").rename(raiz / "skill.md")
        res = self.validar(raiz)
        self.assertError(res, "renombra «skill.md» a «SKILL.md»")

    def test_carpeta_inexistente(self):
        self.assertEqual(self.validar(self.tmp / "no-existe").returncode, 2)

    # --- Frontmatter roto ---
    def test_sin_frontmatter(self):
        raiz = self.skill()
        (raiz / "SKILL.md").write_text("# Sin frontmatter\n", encoding="utf-8")
        self.assertError(self.validar(raiz), "debe empezar con una línea '---'")

    def test_frontmatter_sin_cerrar(self):
        raiz = self.skill()
        (raiz / "SKILL.md").write_text(f"---\nname: resumiendo-pruebas\ndescription: {DESC_OK}\n\n# Cuerpo\n",
                                       encoding="utf-8")
        self.assertError(self.validar(raiz), "no se encuentra la línea '---' que cierra")

    def test_yaml_dos_puntos_sin_comillas(self):
        raiz = self.skill(frontmatter="name: resumiendo-pruebas\ndescription: Hace esto: y aquello cuando se pide\n")
        res = self.validar(raiz)
        self.assertError(res, "Frontmatter YAML no válido")
        self.assertIn("SKILL.md:3", res.stdout)

    def test_yaml_comilla_sin_cerrar(self):
        raiz = self.skill(frontmatter='name: "resumiendo-pruebas\ndescription: x\n')
        self.assertError(self.validar(raiz), "comilla doble sin cerrar")

    def test_yaml_clave_duplicada(self):
        raiz = self.skill(frontmatter=f"name: resumiendo-pruebas\nname: otra\ndescription: {DESC_OK}\n")
        self.assertError(self.validar(raiz), "clave duplicada")

    def test_yaml_tabulador(self):
        raiz = self.skill(frontmatter=f"name: resumiendo-pruebas\ndescription: {DESC_OK}\nmetadata:\n\tversion: '1'\n")
        self.assertError(self.validar(raiz), "tabuladores")

    def test_yaml_bloques_y_mapas(self):
        fm = ('name: "resumiendo-pruebas"\n'
              "description: >\n  Resume archivos de prueba en una tabla.\n  Usar cuando el usuario pida resumir.\n"
              "license: MIT\nmetadata:\n  version: \"1.0\"\n  autor: equipo\n"
              "allowed-tools: Read Bash\n")
        self.assertValida(self.validar(self.skill(frontmatter=fm)))

    # --- Nombre ---
    def test_nombre_mayusculas(self):
        res = self.validar(self.skill(nombre="Resumiendo-Pruebas"))
        self.assertError(res, "caracteres no permitidos")

    def test_nombre_palabra_reservada(self):
        self.assertError(self.validar(self.skill(nombre="ayudante-claude")), "palabra reservada «claude»")
        self.assertError(self.validar(self.skill(nombre="anthropic-tools")), "palabra reservada «anthropic»")

    def test_nombre_guiones(self):
        self.assertError(self.validar(self.skill(nombre="-pruebas")), "no puede empezar ni terminar con guion")
        self.assertError(self.validar(self.skill(nombre="doble--guion")), "dos guiones seguidos")

    def test_nombre_demasiado_largo(self):
        self.assertError(self.validar(self.skill(nombre="a" * 65)), "el máximo es 64")

    def test_nombre_distinto_de_carpeta(self):
        res = self.validar(self.skill(nombre="resumiendo-pruebas", carpeta="otra-carpeta"))
        self.assertError(res, "no coincide con 'name'")

    def test_falta_nombre(self):
        res = self.validar(self.skill(frontmatter=f"description: {DESC_OK}\n"))
        self.assertError(res, "Falta el campo obligatorio 'name'")

    # --- Descripción ---
    def test_descripcion_demasiado_larga(self):
        larga = "Resume archivos. Usar cuando se pida. " + "x" * 1000
        res = self.validar(self.skill(frontmatter=f"name: resumiendo-pruebas\ndescription: {larga}\n"))
        self.assertError(res, "el máximo es 1024")

    def test_descripcion_mayor_de_200_es_aviso_o_error_estricto(self):
        media = DESC_OK + " " + "Incluye detalles adicionales sobre el formato. " * 4
        raiz = self.skill(frontmatter=f"name: resumiendo-pruebas\ndescription: {media}\n")
        res = self.validar(raiz)
        self.assertValida(res)
        self.assertIn("máximo de 200", res.stdout)
        self.assertError(self.validar(raiz, "--estricto"), "máximo de 200")
        self.assertNotIn("máximo de 200", self.validar(raiz, "--destino", "claude-code").stdout)

    def test_descripcion_con_xml(self):
        res = self.validar(self.skill(frontmatter="name: resumiendo-pruebas\n"
                                                  "description: Usar cuando <tarea> lo pida el usuario siempre\n"))
        self.assertError(res, "no puede contener '<' ni '>'")

    def test_descripcion_vacia(self):
        res = self.validar(self.skill(frontmatter="name: resumiendo-pruebas\ndescription:\n"))
        self.assertError(res, "Falta el campo obligatorio 'description'")

    def test_descripcion_sin_cuando_y_primera_persona(self):
        res = self.validar(self.skill(frontmatter="name: resumiendo-pruebas\n"
                                                  "description: Puedo resumir archivos de prueba en tablas bonitas.\n"))
        self.assertValida(res)
        self.assertIn("no parece indicar cuándo usar", res.stdout)
        self.assertIn("tercera persona", res.stdout)

    # --- Campos ---
    def test_campo_desconocido(self):
        res = self.validar(self.skill(frontmatter=f"name: resumiendo-pruebas\ndescription: {DESC_OK}\nversion: 2\n"))
        self.assertError(res, "Campo desconocido en el frontmatter: 'version'")

    def test_campo_claude_code_segun_destino(self):
        raiz = self.skill(frontmatter=f"name: resumiendo-pruebas\ndescription: {DESC_OK}\n"
                                      "disable-model-invocation: true\n")
        self.assertError(self.validar(raiz), "solo existe en Claude Code")
        self.assertValida(self.validar(raiz, "--destino", "claude-code"))

    def test_compatibilidad_larga(self):
        res = self.validar(self.skill(frontmatter=f"name: resumiendo-pruebas\ndescription: {DESC_OK}\n"
                                                  f"compatibility: {'x' * 501}\n"))
        self.assertError(res, "'compatibility' tiene 501")

    # --- Enlaces ---
    def test_enlace_inexistente(self):
        res = self.validar(self.skill(cuerpo="# P\n\nLee [la guía](reference/guia.md) antes.\n"))
        self.assertError(res, "El archivo enlazado «reference/guia.md» no existe")
        self.assertIn("SKILL.md:8", res.stdout)

    def test_script_ejecutado_inexistente(self):
        res = self.validar(self.skill(cuerpo="# P\n\n```bash\npython3 scripts/falta.py datos.csv\n```\n"))
        self.assertError(res, "El archivo que se ejecuta «scripts/falta.py» no existe")

    def test_enlaces_existentes_y_externos(self):
        cuerpo = ("# P\n\nLee [guía](reference/guia.md), [web](https://example.com) y [sección](#p).\n"
                  "Ejecuta `python3 ${CLAUDE_SKILL_DIR}/scripts/ok.py`.\n")
        raiz = self.skill(cuerpo=cuerpo, archivos={"reference/guia.md": "# Guía\n", "scripts/ok.py": "print(1)\n"})
        self.assertValida(self.validar(raiz))

    def test_enlace_fuera_de_la_skill(self):
        res = self.validar(self.skill(cuerpo="# P\n\nVer [x](../otra/archivo.md).\n"))
        self.assertError(res, "apunta fuera de la carpeta")

    def test_referencia_anidada_y_sin_indice(self):
        guia = "# Guía\n\nVer [detalle](detalle.md).\n" + "línea\n" * 120
        raiz = self.skill(cuerpo="# P\n\nLee [guía](reference/guia.md).\n",
                          archivos={"reference/guia.md": guia, "reference/detalle.md": "# D\n"})
        res = self.validar(raiz)
        self.assertValida(res)
        self.assertIn("referencias anidadas", res.stdout)
        self.assertIn("no tiene tabla de contenidos", res.stdout)

    # --- Secretos ---
    def test_claves_expuestas(self):
        claves = {
            "anthropic": "sk-" + "ant-api03-" + "A1b2C3d4" * 5,
            "aws": "AKIA" + "IOSFODNN7EXAMPLQ",
            "github": "ghp" + "_" + "a1B2c3D4e5" * 4,
            "privada": "-----BEGIN RSA " + "PRIVATE KEY-----",
            "asignacion": 'password = "' + "Tr0ub4dor" + '&3x"',
        }
        for tipo, clave in claves.items():
            with self.subTest(tipo=tipo):
                raiz = self.skill(archivos={"scripts/conf.py": f"VALOR = {clave!r}\n" if tipo != "asignacion"
                                            else clave + "\n"})
                res = self.validar(raiz)
                self.assertError(res, "scripts/conf.py:1")
                shutil.rmtree(raiz)

    def test_marcadores_no_son_secretos(self):
        raiz = self.skill(archivos={"scripts/conf.py": 'import os\nAPI_KEY = os.environ["MI_API_KEY"]\n'
                                                       'password = "<tu-contraseña>"\ntoken = "xxxxxxxxxxxx"\n'})
        self.assertValida(self.validar(raiz))

    # --- Scripts ---
    def test_script_con_error_de_sintaxis(self):
        res = self.validar(self.skill(archivos={"scripts/roto.py": "def f(:\n    pass\n"}))
        self.assertError(res, "Error de sintaxis en Python")
        self.assertIn("scripts/roto.py:1", res.stdout)

    @unittest.skipUnless(shutil.which("bash"), "bash no disponible")
    def test_script_bash_con_error(self):
        res = self.validar(self.skill(archivos={"scripts/roto.sh": "if then fi fi\n"}))
        self.assertError(res, "Error de sintaxis")

    # --- Estructura ---
    def test_varios_skill_md(self):
        raiz = self.skill(archivos={"sub/SKILL.md": "---\nname: sub\ndescription: x\n---\n"})
        self.assertError(self.validar(raiz), "Hay varios SKILL.md")
        self.assertValida(self.validar(raiz, "--destino", "claude-code"))

    def test_cuerpo_largo(self):
        res = self.validar(self.skill(cuerpo="# P\n" + "Instrucción.\n" * 520))
        self.assertValida(res)
        self.assertIn("recomendado: menos de 500", res.stdout)


# =============================================================================
class TestPackage(Base):
    def test_rechaza_skill_con_errores(self):
        raiz = self.skill(cuerpo="# P\n\n[falta](reference/no.md)\n")
        res = ejecutar("package.py", raiz, "--salida", self.tmp / "dist")
        self.assertEqual(res.returncode, 1)
        self.assertIn("No se ha creado el paquete", res.stdout)
        self.assertFalse((self.tmp / "dist" / "resumiendo-pruebas.zip").exists())

    def test_rechaza_campos_de_claude_code(self):
        raiz = self.skill(frontmatter=f"name: resumiendo-pruebas\ndescription: {DESC_OK}\nmodel: inherit\n")
        self.assertEqual(ejecutar("package.py", raiz, "--salida", self.tmp / "dist").returncode, 1)

    def test_paquete_valido_y_reproducible(self):
        raiz = self.skill(archivos={"scripts/ok.py": "print(1)\n", "tests/activacion.json": "{}",
                                    "__pycache__/x.pyc": "x", ".env": "A=1", "notas.md~": "x"})
        dist = self.tmp / "dist"
        res = ejecutar("package.py", raiz, "--salida", dist)
        self.assertEqual(res.returncode, 0, res.stdout)
        zip_path = dist / "resumiendo-pruebas.zip"
        with zipfile.ZipFile(zip_path) as zf:
            nombres = sorted(zf.namelist())
        self.assertEqual(nombres, ["resumiendo-pruebas/SKILL.md", "resumiendo-pruebas/scripts/ok.py"])
        h1 = hashlib.sha256(zip_path.read_bytes()).hexdigest()
        ejecutar("package.py", raiz, "--salida", dist)
        self.assertEqual(h1, hashlib.sha256(zip_path.read_bytes()).hexdigest())

    def test_incluir_tests(self):
        raiz = self.skill(archivos={"tests/activacion.json": "{}"})
        res = ejecutar("package.py", raiz, "--salida", self.tmp / "dist", "--incluir-tests")
        self.assertEqual(res.returncode, 0, res.stdout)
        with zipfile.ZipFile(self.tmp / "dist" / "resumiendo-pruebas.zip") as zf:
            self.assertIn("resumiendo-pruebas/tests/activacion.json", zf.namelist())

    def test_salida_dentro_de_la_skill(self):
        raiz = self.skill()
        self.assertEqual(ejecutar("package.py", raiz, "--salida", raiz / "dist").returncode, 1)


# =============================================================================
class TestInstall(Base):
    def entorno(self):
        casa = self.tmp / "casa"
        casa.mkdir(exist_ok=True)
        return {**os.environ, "HOME": str(casa)}, casa

    def test_instala_y_no_sobrescribe_sin_confirmacion(self):
        env, casa = self.entorno()
        raiz = self.skill(cuerpo="# P\n\nVersión 1.\n")
        res = ejecutar("install.py", raiz, "--ambito", "personal", env=env)
        self.assertEqual(res.returncode, 0, res.stdout)
        instalado = casa / ".claude" / "skills" / "resumiendo-pruebas" / "SKILL.md"
        self.assertIn("Versión 1", instalado.read_text(encoding="utf-8"))

        (raiz / "SKILL.md").write_text((raiz / "SKILL.md").read_text().replace("Versión 1", "Versión 2"))
        res = ejecutar("install.py", raiz, "--ambito", "personal", env=env, entrada="")
        self.assertEqual(res.returncode, 1)
        self.assertIn("cancelada", res.stdout)
        self.assertIn("Versión 1", instalado.read_text(encoding="utf-8"))
        self.assertFalse((casa / ".claude" / "skill-backups").exists())

        res = ejecutar("install.py", raiz, "--ambito", "personal", "--si", env=env)
        self.assertEqual(res.returncode, 0, res.stdout)
        self.assertIn("Versión 2", instalado.read_text(encoding="utf-8"))
        copias = list((casa / ".claude" / "skill-backups").iterdir())
        self.assertEqual(len(copias), 1)
        self.assertRegex(copias[0].name, r"^resumiendo-pruebas-\d{8}-\d{6}$")
        self.assertIn("Versión 1", (copias[0] / "SKILL.md").read_text(encoding="utf-8"))
        # La copia no queda dentro de skills/ (Claude Code la cargaría como skill duplicada)
        self.assertEqual([p.name for p in (casa / ".claude" / "skills").iterdir()], ["resumiendo-pruebas"])

    def test_ambito_proyecto(self):
        proyecto = self.tmp / "proyecto"
        proyecto.mkdir()
        res = ejecutar("install.py", self.skill(), "--ambito", "proyecto", "--proyecto", proyecto)
        self.assertEqual(res.returncode, 0, res.stdout)
        self.assertTrue((proyecto / ".claude" / "skills" / "resumiendo-pruebas" / "SKILL.md").is_file())

    def test_no_instala_skill_invalida(self):
        env, casa = self.entorno()
        res = ejecutar("install.py", self.skill(nombre="Mal-Nombre"), "--ambito", "personal", env=env)
        self.assertEqual(res.returncode, 1)
        self.assertFalse((casa / ".claude" / "skills").exists())

    def test_excluye_caches(self):
        env, casa = self.entorno()
        raiz = self.skill(archivos={"__pycache__/a.pyc": "x", "scripts/ok.py": "print(1)\n"})
        ejecutar("install.py", raiz, "--ambito", "personal", env=env)
        destino = casa / ".claude" / "skills" / "resumiendo-pruebas"
        self.assertTrue((destino / "scripts" / "ok.py").exists())
        self.assertFalse((destino / "__pycache__").exists())


# =============================================================================
class TestTriggers(Base):
    def casos(self, raiz, datos):
        (raiz / "tests").mkdir(exist_ok=True)
        (raiz / "tests" / "activacion.json").write_text(json.dumps(datos), encoding="utf-8")

    def test_checklist_manual(self):
        raiz = self.skill()
        self.casos(raiz, {"casos": [{"peticion": "Resume prueba.txt", "debe_activarse": True},
                                    {"peticion": "¿Qué hora es?", "debe_activarse": False}]})
        res = ejecutar("test_triggers.py", raiz, "--manual")
        self.assertEqual(res.returncode, 3, res.stdout + res.stderr)
        checklist = (raiz / "tests" / "checklist-activacion.md").read_text(encoding="utf-8")
        self.assertIn("- [ ] 1. (DEBE activarse) «Resume prueba.txt»", checklist)
        self.assertIn("(NO debe activarse)", checklist)

    def test_sin_cli_genera_checklist(self):
        raiz = self.skill()
        self.casos(raiz, {"casos": [{"peticion": "Resume prueba.txt", "debe_activarse": True}]})
        env = {**os.environ, "PATH": str(self.tmp)}  # PATH sin `claude`
        res = ejecutar("test_triggers.py", raiz, env=env)
        self.assertEqual(res.returncode, 3, res.stdout + res.stderr)
        self.assertIn("no está instalada", res.stdout)

    def test_json_invalido(self):
        raiz = self.skill()
        (raiz / "tests").mkdir()
        (raiz / "tests" / "activacion.json").write_text('{"casos": [', encoding="utf-8")
        res = ejecutar("test_triggers.py", raiz, "--manual")
        self.assertEqual(res.returncode, 2)
        self.assertIn("JSON no válido", res.stderr)

    def test_caso_mal_formado(self):
        raiz = self.skill()
        self.casos(raiz, {"casos": [{"peticion": "x", "debe_activarse": "sí"}]})
        res = ejecutar("test_triggers.py", raiz, "--manual")
        self.assertEqual(res.returncode, 2)
        self.assertIn("debe_activarse", res.stderr)

    def test_sin_archivo(self):
        res = ejecutar("test_triggers.py", self.skill(), "--manual")
        self.assertEqual(res.returncode, 2)
        self.assertIn("no existe", res.stderr)


if __name__ == "__main__":
    unittest.main()
