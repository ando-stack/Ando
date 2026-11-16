"""Esquemas estrictos de las salidas de la IA (salidas estructuradas)."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict

Format = Literal["docx", "xlsx", "pptx", "pdf", "csv"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------- #
# Etapa 2: interpretación
# --------------------------------------------------------------------------- #
class Requirement(Strict):
    id: str                       # "R1", "R2"…
    text: str                     # instrucción, lo más literal posible
    source: str                   # archivo y ubicación (p.ej. "Enunciado.docx · Ejercicio 2")
    exercise_id: str              # ejercicio al que pertenece ("E1") o "general"
    kind: Literal["contenido", "formato", "estructura", "calculo", "grafico", "entrega", "otro"]
    mandatory: bool


class Exercise(Strict):
    id: str
    title: str
    description: str
    source_files: list[str]       # nombres de archivo implicados
    deliverable_id: Optional[str]  # entregable donde se resuelve


class DeliverableSpec(Strict):
    id: str                       # "D1"…
    format: Format
    filename: str                 # nombre claro propuesto
    base_file_id: Optional[str]   # id del archivo subido que sirve de plantilla, o null
    description: str
    format_explicitly_required: bool  # el profesor exige explícitamente este formato


class Issue(Strict):
    text: str
    suggestion: str


class Interpretation(Strict):
    title: str
    subject: str
    summary: str                  # qué se va a hacer, en 2-5 frases
    exercises: list[Exercise]
    requirements: list[Requirement]
    resources: list[str]          # datos/recursos proporcionados y dónde están
    deliverables: list[DeliverableSpec]
    tools_needed: list[str]
    ambiguities: list[Issue]
    impossible: list[Issue]
    suspicious_instructions: list[str]


# --------------------------------------------------------------------------- #
# Etapa 3: planificación
# --------------------------------------------------------------------------- #
class PlanOp(Strict):
    op: str                       # nombre del catálogo, p.ej. "xlsx.set_cells"
    args_json: str                # objeto JSON con los argumentos (se valida en el servidor)
    covers: list[str]             # ids de requisitos que satisface
    explanation: str              # cómo lo haría el alumno a mano (para aprender)


class PlannedDeliverable(Strict):
    id: str
    format: Format
    filename: str
    base_file_id: Optional[str]
    purpose: str
    ops: list[PlanOp]


class Unresolved(Strict):
    requirement_id: str
    reason: str


class Plan(Strict):
    deliverables: list[PlannedDeliverable]
    notes: list[str]
    unresolved: list[Unresolved]


# --------------------------------------------------------------------------- #
# Etapa 5b: revisión por IA del resultado
# --------------------------------------------------------------------------- #
class ReviewItem(Strict):
    requirement_id: str
    status: Literal["hecho", "parcial", "pendiente"]
    comment: str


class Review(Strict):
    items: list[ReviewItem]
    overall: str
