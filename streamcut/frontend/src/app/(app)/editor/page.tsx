"use client";

import { useQuery } from "@tanstack/react-query";
import { Film } from "lucide-react";
import { ClipCard } from "@/components/ClipCard";
import { Empty, PageHeader, Spinner } from "@/components/ui";
import { get } from "@/lib/api";
import type { Clip } from "@/lib/types";

export default function EditorIndex() {
  const clips = useQuery({ queryKey: ["clips", "editor-index"], queryFn: () => get<{ items: Clip[] }>("/clips?sort=recent&limit=40") });
  const editable = clips.data?.items.filter((c) => c.source_asset_id) ?? [];
  return (
    <div>
      <PageHeader title="Editor" description="Elige un clip para recortarlo, dividirlo, cambiar su formato, editar subtítulos, reencuadrar y exportar una nueva versión." />
      {clips.isLoading ? <Spinner /> : editable.length === 0 ? (
        <Empty icon={<Film className="h-5 w-5" />} title="No hay clips editables">Los clips con MP4 propio (vídeos importados o directos con fuente autorizada) se pueden editar aquí.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{editable.map((c) => <ClipCard key={c.id} clip={c} />)}</div>
      )}
    </div>
  );
}
