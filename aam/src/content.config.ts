import { defineCollection } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * Esquemas de contenido. Si falta un campo obligatorio o tiene un formato
 * incorrecto, `npm run build` se detiene y muestra qué archivo y qué campo fallan.
 */

const url = z.url({ error: 'Debe ser una URL completa (https://...)' });

// ---------- Proyectos: src/content/projects/*.md ----------
const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: ({ image }) =>
    z.object({
      title: z.string({ error: 'Falta "title" (título del proyecto)' }).min(1),
      summary: z.string({ error: 'Falta "summary" (resumen corto)' }).min(1),
      category: z.string({ error: 'Falta "category" (categoría para el filtro)' }).min(1),
      year: z.number({ error: 'Falta "year" (año, número de 4 cifras)' }).int().min(1990).max(2100),
      role: z.string({ error: 'Falta "role" (tu rol en el proyecto)' }).min(1),
      technologies: z.array(z.string()).min(1, 'Añade al menos una tecnología en "technologies"'),
      cover: image().optional(),
      coverAlt: z.string().default(''),
      video: z.string().optional(), // ruta a un .mp4 en /public (opcional)
      links: z
        .object({
          web: url.optional(),
          repo: url.optional(),
        })
        .default({}),
      challenge: z.string({ error: 'Falta "challenge" (el desafío)' }).min(1),
      solution: z.string({ error: 'Falta "solution" (la solución)' }).min(1),
      result: z.string({ error: 'Falta "result" (el resultado)' }).min(1),
      gallery: z
        .array(
          z.object({
            src: image(),
            alt: z.string({ error: 'Cada imagen de la galería necesita "alt"' }),
          }),
        )
        .default([]),
      order: z.number().default(0), // menor = aparece antes
      featured: z.boolean().default(true),
      draft: z.boolean().default(false),
    }),
});

// ---------- Experiencia: src/content/experience/*.md ----------
const experience = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/experience' }),
  schema: z.object({
    role: z.string({ error: 'Falta "role" (puesto)' }).min(1),
    company: z.string({ error: 'Falta "company" (empresa o proyecto)' }).min(1),
    location: z.string().optional(),
    start: z.string({ error: 'Falta "start" (fecha de inicio, p. ej. "2021")' }).min(1),
    end: z.string().default('Actualidad'),
    order: z.number().default(0), // menor = aparece antes (lo más reciente primero)
  }),
});

// ---------- Textos generales: src/content/site.json ----------
const social = z.object({
  label: z.string().min(1),
  url,
});

const site = defineCollection({
  loader: file('./src/content/site.json', {
    parser: (text) => [{ id: 'site', ...JSON.parse(text) }],
  }),
  schema: ({ image }) =>
    z.object({
      heroTitle: z.array(z.string().min(1)).min(1, 'Añade al menos una línea en "heroTitle"'),
      brand: z.string().min(1),
      role: z.string().min(1),
      tagline: z.string().min(1),
      location: z.string().optional(),
      availability: z.string().optional(),
      email: z.email({ error: '"email" debe ser un correo válido' }),
      seo: z.object({
        title: z.string().min(1),
        description: z.string().min(1).max(170, 'La meta descripción debería tener 170 caracteres o menos'),
      }),
      about: z.object({
        title: z.string().min(1),
        paragraphs: z.array(z.string()).min(1),
        photo: image().optional(),
        photoAlt: z.string().default(''),
        stats: z
          .array(
            z.object({
              value: z.number(),
              suffix: z.string().default(''),
              label: z.string(),
            }),
          )
          .default([]),
      }),
      services: z.array(
        z.object({
          icon: z.enum(['code', 'design', 'motion', 'strategy', 'performance', 'spark', 'social']),
          title: z.string(),
          description: z.string(),
        }),
      ),
      stack: z.array(z.string()).min(1),
      contact: z.object({
        title: z.string().min(1),
        intro: z.string(),
      }),
      socials: z.array(social).default([]),
      pricing: z
        .object({
          title: z.string().min(1),
          intro: z.string().default(''),
          currency: z.string().default('€'),
          plans: z
            .array(
              z.object({
                icon: z.enum(['code', 'design', 'motion', 'strategy', 'performance', 'spark', 'social']).default('spark'),
                title: z.string().min(1),
                prefix: z.string().default('desde'), // texto antes del precio ("desde", "")
                price: z.number({ error: 'Cada plan necesita "price" (número)' }).min(0),
                unit: z.string().default(''), // p. ej. "/ short", "/ mes"
                description: z.string().default(''),
                features: z.array(z.string()).default([]),
                extras: z.array(z.string()).default([]), // precios adicionales o packs
                highlight: z.string().optional(), // etiqueta destacada (p. ej. "Recomendado")
                wide: z.boolean().default(false), // ocupa todo el ancho
              }),
            )
            .min(1),
          note: z.string().default(''),
          cta: z.string().default('Pedir presupuesto'),
        })
        .optional(),
    }),
});

export const collections = { projects, experience, site };
