// Esquemas de las respuestas de la IA (salidas estructuradas). Toda la generación cita "fuentes" (F1, F2…).

import { z } from "zod";

const fuentes = z.array(z.string()).describe('Referencias de los fragmentos de los apuntes de los que sale, p. ej. ["F2","F5"]. Vacío solo si ampliacion es true.');
const ampliacion = z.boolean().describe("true solo si es una aclaración propia que NO aparece en los apuntes.");

export const esquemaLectura = z.object({
  legible: z.boolean().describe("false si la imagen entera no se puede leer o no son apuntes"),
  calidad: z.enum(["buena", "regular", "mala"]),
  aviso: z.string().describe("Vacío si todo está bien. Si hay problemas, explicación breve y consejo para una foto mejor."),
  paginas: z.array(
    z.object({
      numero: z.number().int(),
      markdown: z.string().describe("Transcripción fiel en Markdown con LaTeX. Lo dudoso entre [[? y ?]]."),
      dudas: z.array(z.object({ texto: z.string().describe("Texto dudoso tal como aparece entre [[? ?]]"), motivo: z.string() })),
    }),
  ),
  secciones: z.array(
    z.object({ titulo: z.string(), nivel: z.number().int(), pagina: z.number().int(), tema_sugerido: z.string().describe("Tema del examen al que parece pertenecer, o vacío") }),
  ),
});

export const esquemaOrganizacion = z.object({
  asignaciones: z.array(
    z.object({
      upload_id: z.string(),
      tema_id: z.string().describe("id de un tema existente, o vacío si hace falta uno nuevo"),
      tema_nuevo: z.string().describe("título del tema nuevo si tema_id está vacío; vacío en otro caso"),
    }),
  ),
});

const itemCitado = z.object({ texto: z.string(), fuentes, ampliacion });

export const esquemaResumen = z.object({
  ideas_clave: z.array(itemCitado).describe("5-10 ideas clave, una frase cada una"),
  resumen: z.array(itemCitado).describe("Resumen: párrafos breves"),
  detallado: z.array(itemCitado).describe("Resumen detallado: puede usar subtítulos (### …), listas y fórmulas"),
});

export const esquemaMapa = z.object({
  titulo: z.string(),
  nodos: z.array(
    z.object({
      id: z.string().describe("n1, n2…"),
      padre: z.string().describe('id del nodo padre; "" para el nodo raíz (solo uno)'),
      texto: z.string().describe("Concepto breve (máx. 12 palabras), puede incluir una relación: «causa →»"),
      fuentes,
      ampliacion,
    }),
  ),
});

export const esquemaFlashcards = z.object({
  tarjetas: z.array(
    z.object({
      tipo: z.enum(["pregunta", "huecos", "definicion", "formula", "fecha"]),
      anverso: z.string().describe("Pregunta o frase con huecos (usa ____ para el hueco)"),
      reverso: z.string().describe("Respuesta breve y exacta según los apuntes"),
      fuentes,
    }),
  ),
});

export const esquemaTest = z.object({
  preguntas: z.array(
    z.object({
      tipo: z.enum(["opcion_multiple", "verdadero_falso", "respuesta_corta", "relacionar", "ordenar"]),
      enunciado: z.string(),
      opciones: z.array(z.string()).optional().describe("opcion_multiple: 4 opciones"),
      correcta: z.number().int().optional().describe("opcion_multiple: índice (0-3) de la correcta"),
      verdadero: z.boolean().optional().describe("verdadero_falso: si la afirmación es verdadera"),
      respuestas_aceptadas: z.array(z.string()).optional().describe("respuesta_corta: respuestas válidas"),
      palabras_clave: z.array(z.string()).optional().describe("respuesta_corta: palabras clave imprescindibles"),
      pares: z.array(z.object({ izquierda: z.string(), derecha: z.string() })).optional().describe("relacionar: 3-5 pares correctos"),
      orden_correcto: z.array(z.string()).optional().describe("ordenar: 3-6 elementos en el orden correcto"),
      explicacion: z.string().describe("Por qué es así, según los apuntes"),
      fuentes,
      ampliacion,
    }),
  ),
});

export const esquemaSimulacro = z.object({
  titulo: z.string(),
  preguntas: z.array(
    z.object({
      tipo: z.enum(["test", "cortas", "desarrollo", "problemas"]),
      enunciado: z.string(),
      opciones: z.array(z.string()).optional().describe("test: 4 opciones"),
      correcta: z.number().int().optional().describe("test: índice de la correcta"),
      respuesta_modelo: z.string().optional().describe("cortas/desarrollo/problemas: respuesta ideal según los apuntes (con pasos en problemas)"),
      rubrica: z
        .array(z.object({ criterio: z.string(), puntos: z.number() }))
        .optional()
        .describe("cortas/desarrollo/problemas: criterios de corrección con su peso relativo"),
      fuentes,
    }),
  ),
});

export const esquemaCorreccion = z.object({
  correcciones: z.array(
    z.object({
      pregunta_id: z.string(),
      criterios: z.array(z.object({ criterio: z.string(), puntos_obtenidos: z.number(), puntos_max: z.number(), comentario: z.string() })),
      comentario: z.string().describe("Valoración breve, positiva y concreta"),
      para_subir_nota: z.string().describe("Qué falta o qué mejorar para conseguir más puntos"),
      fuentes,
    }),
  ),
  resumen: z.string().describe("Valoración global en 2-3 frases, empezando por lo que está bien"),
  para_subir_nota: z.array(z.string()).describe("3-5 consejos concretos para subir nota"),
});

export const esquemaFeynman = z.object({
  valoracion: z.string().describe("2-3 frases, empezando por lo positivo"),
  bien_explicado: z.array(itemCitado),
  lagunas: z.array(itemCitado).describe("Ideas importantes de los apuntes que faltan en la explicación"),
  errores: z.array(z.object({ lo_que_dijiste: z.string(), correccion: z.string(), fuentes })),
  confuso: z.array(itemCitado).describe("Partes poco claras y cómo explicarlas mejor"),
  siguiente_paso: z.string(),
});

export const esquemaTutor = z.object({
  respuesta: z.string().describe("Respuesta en Markdown. Lo que no esté en los apuntes, en un bloque que empiece por «> **Ampliación:**»"),
  fuentes,
  hay_ampliacion: z.boolean(),
  sin_informacion: z.boolean().describe("true si los apuntes no contienen información para responder"),
});
