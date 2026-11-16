"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, LayoutTemplate, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, Card, Field, Modal, PageHeader, Select, Spinner, Toggle } from "@/components/ui";
import { ApiError, del, get, post, put } from "@/lib/api";
import { useApp } from "@/lib/store";
import type { Template } from "@/lib/types";

const LAYOUTS = [{ value: "fit_blur", label: "Completo + fondo difuminado" }, { value: "crop", label: "Reencuadre" },
  { value: "split", label: "Split (webcam + gameplay)" }, { value: "fit_black", label: "Completo con bandas" }];

const BLANK = { format: "9:16", layout: { mode: "fit_blur" }, zoom: { enabled: false },
  subtitles: { enabled: true, style: { font: "Inter", size: 72, bold: true, uppercase: false, color: "#FFFFFF", highlight_color: "#A78BFA", outline: 5, shadow: 2, position: "bottom", animation: "karaoke", words_per_line: 4 } },
  audio: { normalize: true, target_lufs: -14, limiter: true } };

function Editor({ tpl, onClose }: { tpl: Template | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useApp((s) => s.toast);
  const [name, setName] = useState(tpl?.name ?? "Mi plantilla");
  const [desc, setDesc] = useState(tpl?.description ?? "");
  const [spec, setSpec] = useState<any>(structuredClone(tpl?.spec ?? BLANK));
  const st = spec.subtitles?.style ?? {};
  const upd = (fn: (s: any) => void) => setSpec((s: any) => { const n = structuredClone(s); fn(n); return n; });
  const save = useMutation({
    mutationFn: () => tpl ? put(`/templates/${tpl.id}`, { name, description: desc, spec }) : post("/templates", { name, description: desc, spec }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["templates"] }); toast("Plantilla guardada", "ok"); onClose(); },
    onError: (e: ApiError) => toast(e.message, "error"),
  });
  return (
    <Modal open onClose={onClose} title={tpl ? `Editar «${tpl.name}»` : "Nueva plantilla"} wide>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Nombre"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Descripción"><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <Field label="Formato"><Select value={spec.format} onChange={(v) => upd((s) => { s.format = v; })} options={["9:16", "16:9", "1:1"].map((f) => ({ value: f, label: f }))} /></Field>
        <Field label="Composición"><Select value={spec.layout?.mode ?? "fit_blur"} onChange={(v) => upd((s) => { s.layout = { ...(s.layout ?? {}), mode: v }; })} options={LAYOUTS} /></Field>
        {spec.layout?.mode === "split" && <Field label={`Altura webcam ${Math.round((spec.layout.split_ratio ?? 0.38) * 100)}%`}><input type="range" min={0.2} max={0.6} step={0.01} value={spec.layout.split_ratio ?? 0.38} onChange={(e) => upd((s) => { s.layout.split_ratio = +e.target.value; })} className="w-full accent-[var(--color-accent)]" /></Field>}
        {spec.layout?.mode === "crop" && <Toggle checked={!!spec.layout.face_center} onChange={(v) => upd((s) => { s.layout.face_center = v; })} label="Centrar en la cara detectada" />}
        <div className="flex flex-wrap items-center gap-4">
          <Toggle checked={!!spec.zoom?.enabled} onChange={(v) => upd((s) => { s.zoom = { ...(s.zoom ?? {}), enabled: v, auto_punch_in: v }; })} label="Zoom en el momento clave" />
          {spec.zoom?.enabled && <input className="input w-24" type="number" step={0.01} min={1.02} max={1.5} value={spec.zoom.scale ?? 1.12} onChange={(e) => upd((s) => { s.zoom.scale = +e.target.value; })} aria-label="Escala del zoom" />}
        </div>
        <Toggle checked={!!spec.subtitles?.enabled} onChange={(v) => upd((s) => { s.subtitles = { ...(s.subtitles ?? {}), enabled: v }; })} label="Subtítulos" />
        {spec.subtitles?.enabled && (<>
          <Field label="Tipografía"><Select value={st.font ?? "Inter"} onChange={(v) => upd((s) => { s.subtitles.style.font = v; })} options={["Inter", "Arial", "Montserrat", "Impact", "Verdana"].map((f) => ({ value: f, label: f }))} /></Field>
          <Field label={`Tamaño ${st.size ?? 72}`}><input type="range" min={24} max={140} value={st.size ?? 72} onChange={(e) => upd((s) => { s.subtitles.style.size = +e.target.value; })} className="w-full accent-[var(--color-accent)]" /></Field>
          <Field label="Color / resaltado"><div className="flex gap-2"><input type="color" className="h-9 flex-1 rounded-lg border border-line bg-panel-2" value={st.color ?? "#FFFFFF"} onChange={(e) => upd((s) => { s.subtitles.style.color = e.target.value.toUpperCase(); })} /><input type="color" className="h-9 flex-1 rounded-lg border border-line bg-panel-2" value={st.highlight_color ?? "#A78BFA"} onChange={(e) => upd((s) => { s.subtitles.style.highlight_color = e.target.value.toUpperCase(); })} /></div></Field>
          <Field label="Posición / animación"><div className="flex gap-2">
            <Select value={st.position ?? "bottom"} onChange={(v) => upd((s) => { s.subtitles.style.position = v; })} options={[{ value: "bottom", label: "Abajo" }, { value: "middle", label: "Centro" }, { value: "top", label: "Arriba" }]} />
            <Select value={st.animation ?? "karaoke"} onChange={(v) => upd((s) => { s.subtitles.style.animation = v; })} options={[{ value: "karaoke", label: "Resaltado" }, { value: "pop", label: "Pop" }, { value: "none", label: "Ninguna" }]} />
          </div></Field>
          <Toggle checked={!!st.uppercase} onChange={(v) => upd((s) => { s.subtitles.style.uppercase = v; })} label="Mayúsculas" />
        </>)}
        <Toggle checked={!!spec.audio?.normalize} onChange={(v) => upd((s) => { s.audio = { ...(s.audio ?? {}), normalize: v }; })} label="Normalizar audio" />
        <Toggle checked={!!spec.audio?.denoise} onChange={(v) => upd((s) => { s.audio = { ...(s.audio ?? {}), denoise: v }; })} label="Reducción de ruido" />
      </div>
      <div className="mt-5 flex justify-end gap-2"><button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending && <Spinner />}Guardar</button></div>
    </Modal>
  );
}

export default function TemplatesPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["templates"], queryFn: () => get<Template[]>("/templates") });
  const [editing, setEditing] = useState<Template | null | "new">(null);
  const dup = useMutation({ mutationFn: (id: string) => post(`/templates/${id}/duplicate`), onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }) });
  const remove = useMutation({ mutationFn: (id: string) => del(`/templates/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }) });
  return (
    <div>
      <PageHeader title="Plantillas" description="Presets de edición automática. Asigna una plantilla por defecto a cada streamer desde Canales."
        actions={<button className="btn-primary" onClick={() => setEditing("new")}><Plus className="h-4 w-4" />Nueva plantilla</button>} />
      {list.isLoading ? <Spinner /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.data?.map((t) => (
            <Card key={t.id} className="flex flex-col p-4">
              <div className="flex items-start gap-3">
                <div className="grid h-14 w-10 shrink-0 place-items-center rounded-md border border-line bg-panel-2 text-accent-soft" style={{ aspectRatio: t.spec.format === "16:9" ? "16/9" : t.spec.format === "1:1" ? "1" : "9/16", width: t.spec.format === "16:9" ? 64 : 40, height: "auto" }}>
                  <LayoutTemplate className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><h3 className="font-medium">{t.name}</h3>{t.is_builtin && <Badge>Predefinida</Badge>}</div>
                  <p className="mt-1 text-xs text-muted">{t.description}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                <span className="chip">{t.spec.format}</span>
                <span className="chip">{LAYOUTS.find((l) => l.value === t.spec.layout?.mode)?.label}</span>
                {t.spec.subtitles?.enabled && <span className="chip">Subtítulos {t.spec.subtitles.style?.animation}</span>}
                {t.spec.zoom?.enabled && <span className="chip">Zoom</span>}
              </div>
              <div className="mt-auto flex gap-1 pt-4">
                {!t.is_builtin && <button className="btn-ghost h-8 text-xs" onClick={() => setEditing(t)}><Pencil className="h-3.5 w-3.5" />Editar</button>}
                <button className="btn-ghost h-8 text-xs" onClick={() => dup.mutate(t.id)}><Copy className="h-3.5 w-3.5" />Duplicar</button>
                {!t.is_builtin && <button className="btn-ghost ml-auto h-8 text-xs text-danger" onClick={() => remove.mutate(t.id)}><Trash2 className="h-3.5 w-3.5" /></button>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <Editor tpl={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
