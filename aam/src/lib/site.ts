/** Acceso tipado al contenido (site.json, proyectos y experiencia). */
import { getCollection, getEntry } from 'astro:content';

export async function getSite() {
  const entry = await getEntry('site', 'site');
  if (!entry) throw new Error('[AAM] No se encuentra src/content/site.json');
  return entry.data;
}

const warned = new Set<string>();

export async function getProjects() {
  const projects = (await getCollection('projects', ({ data }) => !data.draft)).sort(
    (a, b) => a.data.order - b.data.order || b.data.year - a.data.year,
  );
  for (const p of projects) {
    if (!p.data.cover && !warned.has(p.id)) {
      warned.add(p.id);
      console.warn(
        `\x1b[33m[AAM] El proyecto "${p.id}" no tiene imagen de portada ("cover"). Se mostrará un marcador en su lugar.\x1b[0m`,
      );
    }
  }
  return projects;
}

export async function getExperience() {
  return (await getCollection('experience')).sort((a, b) => a.data.order - b.data.order);
}

export const sections = [
  { id: 'sobre-mi', label: 'Sobre mí' },
  { id: 'servicios', label: 'Servicios' },
  { id: 'proyectos', label: 'Proyectos' },
  { id: 'experiencia', label: 'Experiencia' },
  { id: 'contacto', label: 'Contacto' },
] as const;
