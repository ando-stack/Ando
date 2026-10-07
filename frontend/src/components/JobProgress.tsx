import type {Job} from '../api';
import {cancelJob} from '../api';

export function JobProgress({job, compact}: {job: Job; compact?: boolean}) {
  const running = job.status === 'ejecutando' || job.status === 'pendiente';
  return (
    <div className={`bg-zinc-900 border border-zinc-700 rounded-lg ${compact ? 'p-2' : 'p-4'}`}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="truncate">
          <span className="font-semibold">{job.label}</span>
          <span className="text-zinc-400"> · {job.message || job.status}</span>
        </div>
        {running && (
          <button onClick={() => cancelJob(job.id)} className="text-xs px-2 py-1 rounded bg-zinc-700 hover:bg-red-700 shrink-0">
            Cancelar
          </button>
        )}
      </div>
      <div className="h-2 bg-zinc-800 rounded mt-2 overflow-hidden">
        <div
          className={`h-full transition-all ${job.status === 'error' ? 'bg-red-500' : job.status === 'cancelada' ? 'bg-zinc-500' : 'bg-pink-500'}`}
          style={{width: `${Math.round(job.progress * 100)}%`}}
        />
      </div>
      {job.error && <div className="text-red-400 text-xs mt-2 whitespace-pre-wrap">{job.error}</div>}
    </div>
  );
}
