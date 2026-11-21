"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { Card, CardHeader, ErrorBox, Loading, PageHeader } from "@/components/ui";
import { useApi } from "@/lib/hooks";

export default function SettingsPage() {
  const { data, error, loading, reload } = useApi<any>("/system/status");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;
  return (
    <div className="fade-in">
      <PageHeader eyebrow="Configuración" title="Estado del sistema" subtitle="Qué capacidades están disponibles en este servidor. Las claves se configuran solo en el backend." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Procesamiento" />
          <ul className="divide-y divide-line">
            <Row ok={!!data.ffmpeg} label="FFmpeg" detail={data.ffmpeg || "No encontrado"} />
            <Row ok={data.ai.configured} label="Modelo multimodal" detail={data.ai.configured ? `${data.ai.provider} · ${data.ai.model} · esfuerzo ${data.ai.effort}` : data.ai.detail} />
            <Row ok={data.speech_to_text.available} label="Transcripción de voz" detail={data.speech_to_text.detail} optional />
          </ul>
        </Card>
        <Card>
          <CardHeader title="Adaptadores de replay" subtitle="Se usan en orden; si uno falla se recurre al siguiente" />
          <ul className="divide-y divide-line">
            {data.replay_adapters.map((a: any) => <Row key={a.name} ok={a.available} label={a.name} detail={`${a.detail} · ${a.capabilities.join(", ")}`} optional={a.name !== "native-events"} />)}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Límites" />
          <dl className="grid grid-cols-2 gap-y-2 p-5 text-sm">
            <dt className="text-ink-3">Vídeo máximo</dt><dd className="tabular text-right">{data.limits.max_video_mb} MB · {data.limits.max_video_minutes} min</dd>
            <dt className="text-ink-3">Replay máxima</dt><dd className="tabular text-right">{data.limits.max_replay_mb} MB</dd>
            <dt className="text-ink-3">Tamaño de bloque de subida</dt><dd className="tabular text-right">{data.limits.chunk_mb} MB</dd>
            <dt className="text-ink-3">Segmentos de análisis</dt><dd className="tabular text-right">{data.sampling.segment_seconds} s</dd>
            <dt className="text-ink-3">Fotogramas por segmento / total</dt><dd className="tabular text-right">{data.sampling.max_frames_per_segment} / {data.sampling.max_frames_total}</dd>
          </dl>
        </Card>
        <Card>
          <CardHeader title="Infraestructura" />
          <dl className="grid grid-cols-2 gap-y-2 p-5 text-sm">
            <dt className="text-ink-3">Base de datos</dt><dd className="text-right">{data.database}</dd>
            <dt className="text-ink-3">Almacenamiento</dt><dd className="text-right">{data.storage}</dd>
            <dt className="text-ink-3">Autenticación</dt><dd className="text-right">{data.auth_mode}</dd>
            <dt className="text-ink-3">Worker</dt><dd className="text-right">{data.worker.embedded ? "Integrado en la API" : "Proceso independiente"}</dd>
          </dl>
        </Card>
      </div>
    </div>
  );
}

function Row({ ok, label, detail, optional }: { ok: boolean; label: string; detail: string; optional?: boolean }) {
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <XCircle className={`mt-0.5 size-4 shrink-0 ${optional ? "text-ink-3" : "text-sev-critical"}`} />}
      <div className="min-w-0"><div className="text-sm font-medium">{label}{optional && !ok && <span className="ml-2 text-xs font-normal text-ink-3">opcional</span>}</div><div className="break-words text-xs text-ink-3">{detail}</div></div>
    </li>
  );
}
