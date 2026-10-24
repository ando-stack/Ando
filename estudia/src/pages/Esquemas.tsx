import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { mensajeError } from "../lib/api";
import { sb, useDatos } from "../hooks/useDatos";
import { useExamen } from "../hooks/useExamen";
import type { Fuente, MapaConceptual as Mapa } from "../lib/tipos";
import { MapaConceptual, exportarMapa, todosLosIds } from "../components/MapaConceptual";
import { VisorFragmento } from "../components/Contenido";
import { BotonGenerar } from "../components/Generar";
import { Aviso, Cargando, SelectorTema, Vacio, useToast } from "../components/ui";

export default function Esquemas() {
  const { examen, temas } = useExamen();
  const aviso = useToast();
  const [tema, setTema] = useState<string | null>(temas[0]?.id ?? null);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [fuente, setFuente] = useState<Fuente | null>(null);
  const [exportando, setExportando] = useState(false);
  const { datos, cargando, error, recargar } = useDatos(async () => {
    const q = supabase.from("mindmaps").select("*").eq("exam_id", examen.id);
    return ((await (tema ? q.eq("topic_id", tema) : q.is("topic_id", null)).maybeSingle().then(sb)) ?? null) as Mapa | null;
  }, [examen.id, tema]);

  // Al abrir: raíz y primer nivel desplegados (el resto, para intentar recordarlo antes de desplegar)
  useEffect(() => {
    if (datos) setAbiertos(new Set([datos.raiz.id]));
  }, [datos]);

  const alternar = (id: string) =>
    setAbiertos((a) => {
      const n = new Set(a);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function exportar(formato: "png" | "pdf") {
    if (!datos) return;
    setExportando(true);
    try {
      await exportarMapa(datos.raiz, todosLosIds(datos.raiz), datos.titulo, formato);
    } catch (e) {
      aviso(mensajeError(e), "error");
    } finally {
      setExportando(false);
    }
  }

  const parametros = { topic_id: tema };
  return (
    <div className="space-y-4">
      <SelectorTema temas={temas} valor={tema} alCambiar={setTema} />
      {cargando ? (
        <Cargando />
      ) : error ? (
        <Aviso tipo="error">{error}</Aviso>
      ) : !datos ? (
        <Vacio icono="🧠" titulo="Aún no hay esquema" texto="Creamos un mapa conceptual con la estructura de tus apuntes. Toca los nodos para desplegarlos.">
          <BotonGenerar tipo="esquema" examId={examen.id} parametros={parametros} texto="✨ Generar esquema" alTerminar={() => void recargar(true)} />
        </Vacio>
      ) : (
        <>
          {datos.desactualizado && (
            <Aviso tipo="info" titulo="Has añadido apuntes nuevos">
              <div className="mt-2">
                <BotonGenerar tipo="esquema" examId={examen.id} parametros={parametros} texto="Actualizar el esquema" secundario alTerminar={() => void recargar(true)} />
              </div>
            </Aviso>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="boton-secundario" onClick={() => setAbiertos(todosLosIds(datos.raiz))}>Desplegar todo</button>
            <button type="button" className="boton-fantasma" onClick={() => setAbiertos(new Set([datos.raiz.id]))}>Plegar</button>
            <div className="ml-auto flex gap-2">
              <button type="button" className="boton-secundario" disabled={exportando} onClick={() => exportar("png")}>🖼️ Imagen</button>
              <button type="button" className="boton-secundario" disabled={exportando} onClick={() => exportar("pdf")}>📄 PDF</button>
            </div>
          </div>
          <p className="text-xs text-slate-500">💡 Antes de desplegar un nodo, intenta recordar qué hay dentro. Toca un nodo para ver de qué apunte sale.</p>
          <MapaConceptual raiz={datos.raiz} abiertos={abiertos} alAlternar={alternar} alVerFuente={setFuente} />
          <div className="flex justify-end">
            <BotonGenerar tipo="esquema" examId={examen.id} parametros={parametros} texto="↻ Regenerar" secundario alTerminar={() => void recargar(true)} />
          </div>
        </>
      )}
      <VisorFragmento fuente={fuente} examId={examen.id} alCerrar={() => setFuente(null)} />
    </div>
  );
}
