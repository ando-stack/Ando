"""Infraestructura común de las herramientas documentales.

Cada operación que la IA puede pedir está registrada aquí con:
  - un nombre (``docx.replace_text``),
  - el formato al que se aplica,
  - un modelo Pydantic estricto con sus argumentos,
  - una función Python controlada que la ejecuta.

La IA NUNCA ejecuta código: solo propone operaciones del catálogo, que se validan
contra estos esquemas antes de ejecutarse. Añadir una herramienta nueva = registrar
una función más.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class Args(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OpError(Exception):
    """Error controlado durante la ejecución de una operación."""


@dataclass
class OpSpec:
    name: str
    fmt: str
    args_model: type[Args]
    handler: Callable[["ExecContext", Any], str]
    description: str


REGISTRY: dict[str, OpSpec] = {}


def register(name: str, fmt: str, args_model: type[Args], description: str):
    def deco(fn):
        REGISTRY[name] = OpSpec(name, fmt, args_model, fn, description)
        return fn
    return deco


@dataclass
class Check:
    description: str
    fn: Callable[[Any], bool]
    covers: list[str] = field(default_factory=list)


@dataclass
class ExecContext:
    """Estado de ejecución de UN entregable."""
    fmt: str
    out_path: Path
    inputs: dict[str, dict]          # file_id -> {path, kind, name}
    work_dir: Path
    student_name: str
    date: str
    obj: Any = None                  # Document / Workbook / Presentation / lista de bloques / filas CSV
    base_structure: dict | None = None
    checks: list[Check] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    state: dict = field(default_factory=dict)
    current_covers: list[str] = field(default_factory=list)
    produced: dict[str, Path] = field(default_factory=dict)  # entregables ya generados (para conversiones)

    def check(self, description: str, fn: Callable[[Any], bool]) -> None:
        self.checks.append(Check(description, fn, list(self.current_covers)))

    def input_path(self, file_id: str, kinds: tuple[str, ...] | None = None) -> Path:
        meta = self.inputs.get(file_id)
        if meta is None:
            raise OpError(f"El archivo de origen '{file_id}' no existe en este trabajo.")
        if kinds and meta["kind"] not in kinds:
            raise OpError(f"El archivo '{meta['name']}' es de tipo {meta['kind']}, se esperaba {', '.join(kinds)}.")
        return Path(meta["path"])


PLACEHOLDERS = ("{{ALUMNO}}", "{{FECHA}}")


def substitute(value: Any, ctx: ExecContext) -> Any:
    """Sustituye {{ALUMNO}} y {{FECHA}} en cualquier cadena de los argumentos."""
    if isinstance(value, str):
        return value.replace("{{ALUMNO}}", ctx.student_name).replace("{{FECHA}}", ctx.date)
    if isinstance(value, list):
        return [substitute(v, ctx) for v in value]
    if isinstance(value, dict):
        return {k: substitute(v, ctx) for k, v in value.items()}
    return value


def parse_args(spec: OpSpec, args_json: str, ctx: ExecContext) -> Args:
    try:
        raw = json.loads(args_json) if args_json.strip() else {}
    except json.JSONDecodeError as e:
        raise OpError(f"Argumentos JSON inválidos: {e}") from e
    if not isinstance(raw, dict):
        raise OpError("Los argumentos deben ser un objeto JSON.")
    raw = substitute(raw, ctx)
    try:
        return spec.args_model.model_validate(raw)
    except ValidationError as e:
        msgs = "; ".join(f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}" for err in e.errors()[:6])
        raise OpError(f"Argumentos no válidos para {spec.name}: {msgs}") from e


def catalog_text(formats: set[str] | None = None) -> str:
    """Descripción del catálogo de operaciones para el prompt de planificación."""
    lines = []
    for spec in REGISTRY.values():
        if formats and spec.fmt not in formats:
            continue
        schema = spec.args_model.model_json_schema()
        lines.append(f"### {spec.name}  (formato: {spec.fmt})\n{spec.description}\nArgumentos (JSON Schema): {json.dumps(_compact(schema), ensure_ascii=False)}")
    return "\n\n".join(lines)


def _compact(schema: dict) -> dict:
    """Quita títulos redundantes para acortar el prompt."""
    if isinstance(schema, dict):
        return {k: _compact(v) for k, v in schema.items() if k != "title"}
    if isinstance(schema, list):
        return [_compact(v) for v in schema]
    return schema


# --------------------------------------------------------------------------- #
# Bloques de contenido compartidos (DOCX, PDF)
# --------------------------------------------------------------------------- #
class ChartSpec(Args):
    chart_type: Literal["bar", "column", "line", "pie", "scatter", "area"] = "column"
    title: str = ""
    labels: list[str] = Field(default_factory=list, description="Categorías del eje X o porciones del sector")
    series: list["SeriesSpec"] = Field(default_factory=list)
    x_title: str = ""
    y_title: str = ""


class SeriesSpec(Args):
    name: str = ""
    values: list[float]


ChartSpec.model_rebuild()


class Block(Args):
    type: Literal["heading", "paragraph", "bullets", "numbered", "table", "image", "chart", "page_break", "toc"]
    text: Optional[str] = Field(None, description="Texto (heading/paragraph). Admite **negrita**, *cursiva* y __subrayado__.")
    level: Optional[int] = Field(None, description="Nivel de título 1-4 (heading)")
    style: Optional[str] = Field(None, description="Estilo de párrafo existente en la plantilla (opcional)")
    align: Optional[Literal["left", "center", "right", "justify"]] = None
    items: Optional[list[str]] = Field(None, description="Elementos de lista (bullets/numbered)")
    rows: Optional[list[list[str]]] = Field(None, description="Filas de la tabla (la primera es la cabecera si header=true)")
    header: bool = True
    table_style: Optional[str] = None
    file_id: Optional[str] = Field(None, description="Id de una imagen subida (image)")
    width_cm: Optional[float] = None
    caption: Optional[str] = None
    chart: Optional[ChartSpec] = None


_MARKUP_RE = re.compile(r"(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*)")


def markup_runs(text: str) -> list[tuple[str, dict]]:
    """Convierte **negrita**, *cursiva* y __subrayado__ en trozos con formato."""
    out = []
    for part in _MARKUP_RE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            out.append((part[2:-2], {"bold": True}))
        elif part.startswith("__") and part.endswith("__") and len(part) > 4:
            out.append((part[2:-2], {"underline": True}))
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            out.append((part[1:-1], {"italic": True}))
        else:
            out.append((part, {}))
    return out


def strip_markup(text: str) -> str:
    return "".join(t for t, _ in markup_runs(text))


def render_chart_png(spec: ChartSpec, out: Path) -> Path:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    if not spec.series:
        raise OpError("El gráfico no tiene series de datos.")
    fig, ax = plt.subplots(figsize=(7, 4), dpi=150)
    labels = spec.labels or [str(i + 1) for i in range(len(spec.series[0].values))]
    n = len(spec.series)
    if spec.chart_type == "pie":
        s = spec.series[0]
        ax.pie(s.values, labels=labels[: len(s.values)], autopct="%1.1f%%", startangle=90)
        ax.axis("equal")
    elif spec.chart_type in ("bar", "column"):
        import numpy as np

        x = np.arange(len(labels))
        w = 0.8 / n
        for i, s in enumerate(spec.series):
            pos = x - 0.4 + w / 2 + i * w
            if spec.chart_type == "column":
                ax.bar(pos, s.values[: len(labels)], w, label=s.name)
            else:
                ax.barh(pos, s.values[: len(labels)], w, label=s.name)
        if spec.chart_type == "column":
            ax.set_xticks(x, labels)
        else:
            ax.set_yticks(x, labels)
    elif spec.chart_type == "scatter":
        for s in spec.series:
            xs = [float(v) for v in labels[: len(s.values)]] if all(_isnum(l) for l in labels) else list(range(len(s.values)))
            ax.scatter(xs, s.values, label=s.name)
    else:
        for s in spec.series:
            ax.plot(labels[: len(s.values)], s.values, marker="o", label=s.name)
            if spec.chart_type == "area":
                ax.fill_between(labels[: len(s.values)], s.values, alpha=0.3)
    if spec.title:
        ax.set_title(spec.title)
    if spec.x_title:
        ax.set_xlabel(spec.x_title)
    if spec.y_title:
        ax.set_ylabel(spec.y_title)
    if n > 1 or (spec.series[0].name and spec.chart_type != "pie"):
        ax.legend()
    fig.tight_layout()
    fig.savefig(out, format="png")
    plt.close(fig)
    return out


def _isnum(s: str) -> bool:
    try:
        float(s)
        return True
    except ValueError:
        return False
