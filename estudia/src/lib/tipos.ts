// Tipos compartidos entre la web y las funciones de servidor.

export type TipoExamen = "test" | "cortas" | "desarrollo" | "problemas" | "mixto";
export type Nivel = "bajo" | "medio" | "alto";
export type TipoPregunta = "test" | "cortas" | "desarrollo" | "problemas";

/** Porcentaje aproximado de cada tipo de pregunta (suma ≈ 100). */
export type Distribucion = Partial<Record<TipoPregunta, number>>;

/** Minutos disponibles por día de la semana: "0" = domingo … "6" = sábado. */
export type Disponibilidad = Record<string, number>;

export interface Examen {
  id: string;
  user_id: string;
  asignatura: string;
  curso: string | null;
  fecha: string;
  nota_objetivo: number;
  tipo: TipoExamen;
  distribucion: Distribucion;
  duracion_min: number;
  disponibilidad: Disponibilidad;
  nivel_actual: Nivel;
  color: string;
  archivado: boolean;
  created_at: string;
}

export interface Tema {
  id: string;
  exam_id: string;
  titulo: string;
  orden: number;
}

export type EstadoSubida = "subido" | "leyendo" | "revisar" | "confirmado" | "error";

export interface Subida {
  id: string;
  user_id: string;
  exam_id: string;
  topic_id: string | null;
  tipo: "imagen" | "pdf" | "texto";
  storage_path: string | null;
  nombre_original: string | null;
  orden: number;
  estado: EstadoSubida;
  error: string | null;
  created_at: string;
}

export interface Duda {
  id: string;
  texto: string;
  motivo: string;
  pagina?: number;
  resuelta: boolean;
}

export interface Seccion {
  titulo: string;
  nivel: number;
  pagina?: number;
  tema_sugerido?: string;
}

export interface TextoExtraido {
  id: string;
  upload_id: string;
  exam_id: string;
  contenido: string;
  dudas: Duda[];
  secciones: Seccion[];
  calidad: "buena" | "regular" | "mala" | null;
  legible: boolean;
  aviso: string | null;
  paginas: number;
  revisado: boolean;
  editado_por_usuario: boolean;
}

/** Cita de un fragmento de los apuntes. */
export interface Fuente {
  chunk_id: string;
  origen: string;
}

/** Elemento de texto generado por la IA con su procedencia. */
export interface ItemCitado {
  texto: string;
  fuentes: Fuente[];
  /** true si es una aclaración de la IA que no está en los apuntes. */
  ampliacion: boolean;
}

export interface Resumen {
  id: string;
  exam_id: string;
  topic_id: string | null;
  ideas_clave: ItemCitado[];
  resumen: ItemCitado[];
  detallado: ItemCitado[];
  desactualizado: boolean;
  created_at: string;
}

export interface NodoMapa {
  id: string;
  texto: string;
  fuentes: Fuente[];
  ampliacion: boolean;
  hijos: NodoMapa[];
}

export interface MapaConceptual {
  id: string;
  exam_id: string;
  topic_id: string | null;
  titulo: string;
  raiz: NodoMapa;
  desactualizado: boolean;
}

export type TipoFlashcard = "pregunta" | "huecos" | "definicion" | "formula" | "fecha";
export type EstadoTarjeta = "nueva" | "aprendiendo" | "repaso" | "reaprendiendo";

export interface Flashcard {
  id: string;
  exam_id: string;
  topic_id: string | null;
  tipo: TipoFlashcard;
  anverso: string;
  reverso: string;
  fuentes: Fuente[];
  ampliacion: boolean;
  editada: boolean;
  suspendida: boolean;
  estado: EstadoTarjeta;
  estabilidad: number;
  dificultad: number;
  vence: string;
  ultima_revision: string | null;
  repeticiones: number;
  fallos: number;
}

export type TipoPreguntaTest = "opcion_multiple" | "verdadero_falso" | "respuesta_corta" | "relacionar" | "ordenar";

export interface PreguntaTest {
  id: string;
  tipo: TipoPreguntaTest;
  enunciado: string;
  topic_id: string | null;
  /** opcion_multiple */
  opciones?: string[];
  correcta?: number;
  /** verdadero_falso */
  verdadero?: boolean;
  /** respuesta_corta: respuestas aceptadas y palabras clave */
  respuestas_aceptadas?: string[];
  palabras_clave?: string[];
  /** relacionar: pares izquierda → derecha */
  pares?: { izquierda: string; derecha: string }[];
  /** ordenar: elementos en el orden correcto */
  orden_correcto?: string[];
  explicacion: string;
  fuentes: Fuente[];
  ampliacion: boolean;
}

export interface Test {
  id: string;
  exam_id: string;
  topic_id: string | null;
  titulo: string;
  preguntas: PreguntaTest[];
  created_at: string;
}

export interface CriterioRubrica {
  criterio: string;
  puntos: number;
}

export interface PreguntaSimulacro {
  id: string;
  tipo: TipoPregunta;
  topic_id: string | null;
  enunciado: string;
  puntos: number;
  /** test: opciones */
  opciones?: string[];
  correcta?: number;
  /** cortas/desarrollo/problemas */
  respuesta_modelo?: string;
  rubrica?: CriterioRubrica[];
  fuentes: Fuente[];
}

export interface Simulacro {
  id: string;
  exam_id: string;
  titulo: string;
  duracion_min: number;
  distribucion: Distribucion;
  preguntas: PreguntaSimulacro[];
  created_at: string;
}

export interface CorreccionPregunta {
  pregunta_id: string;
  puntos_obtenidos: number;
  puntos_max: number;
  criterios: { criterio: string; puntos_obtenidos: number; puntos_max: number; comentario: string }[];
  comentario: string;
  para_subir_nota: string;
  fuentes: Fuente[];
}

export interface Correccion {
  preguntas: CorreccionPregunta[];
  nota: number;
  resumen: string;
  para_subir_nota: string[];
}

export interface IntentoSimulacro {
  id: string;
  mock_exam_id: string;
  exam_id: string;
  respuestas: Record<string, string | number>;
  estado: "en_curso" | "corrigiendo" | "corregido" | "error";
  inicio: string;
  fin: string | null;
  correccion: Correccion | null;
  nota: number | null;
  created_at: string;
}

export interface ResultadoPregunta {
  pregunta_id: string;
  topic_id: string | null;
  correcta: boolean;
  puntos: number;
}

export interface IntentoTest {
  id: string;
  quiz_id: string;
  exam_id: string;
  respuestas: Record<string, unknown>;
  resultados: ResultadoPregunta[];
  nota: number;
  created_at: string;
}

export type TipoTarea = "estudio" | "flashcards" | "test" | "simulacro" | "repaso";

export interface TareaPlan {
  id: string;
  tipo: TipoTarea;
  topic_id: string | null;
  titulo: string;
  minutos: number;
  completada?: boolean;
}

export interface DiaPlan {
  fecha: string; // YYYY-MM-DD
  minutos_disponibles: number;
  tareas: TareaPlan[];
  fase: "aprendizaje" | "practica" | "repaso_final" | "descanso";
}

export interface Viabilidad {
  alcanzable: boolean;
  minutos_necesarios: number;
  minutos_disponibles: number;
  mensaje: string;
  sugerencias: string[];
}

export interface PlanEstudio {
  id: string;
  exam_id: string;
  dias: DiaPlan[];
  viabilidad: Viabilidad;
  version: number;
  generado_en: string;
}

export interface Perfil {
  id: string;
  nombre: string;
  fecha_nacimiento: string;
  consentimiento_estado: "pendiente" | "pendiente_tutor" | "concedido" | "retirado";
  consentimiento_ia: boolean;
  tutor_email: string | null;
  preferencias: {
    pomodoro: { trabajo: number; descanso: number; descanso_largo: number; ciclos: number };
    notificaciones: { activas: boolean; hora: string };
    retencion: number;
  };
}

export type TipoTrabajo =
  | "leer_apuntes"
  | "organizar_temas"
  | "resumen"
  | "esquema"
  | "flashcards"
  | "test"
  | "simulacro"
  | "corregir_simulacro"
  | "tutor"
  | "feynman";

export interface TrabajoIA {
  id: string;
  tipo: TipoTrabajo;
  estado: "pendiente" | "en_curso" | "completado" | "error";
  progreso: number;
  mensaje: string | null;
  resultado: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
}

export interface AnalisisFeynman {
  valoracion: string;
  bien_explicado: ItemCitado[];
  lagunas: ItemCitado[];
  errores: { lo_que_dijiste: string; correccion: string; fuentes: Fuente[] }[];
  confuso: ItemCitado[];
  siguiente_paso: string;
}
