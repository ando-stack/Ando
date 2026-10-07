import {useEffect, useState} from 'react';
import {api, fileUrl} from '../api';
import {go} from '../App';
import {fmt} from '../state/player';

interface Item {
  name: string;
  updatedAt?: string;
  duration?: number;
  clips?: number;
  thumbnail?: string | null;
  error?: string;
}

export function Home() {
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    api.get<Item[]>('/api/projects').then(setItems).catch(() => setItems([]));
  }, []);
  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">🎬 Editor de vídeo con IA</h1>
            <p className="text-zinc-400 mt-1">Sube tus clips: se agrupan, se ordenan y se editan solos. Todo en tu ordenador.</p>
          </div>
          <button onClick={() => go({view: 'import'})} className="bg-pink-600 hover:bg-pink-500 px-5 py-3 rounded-lg font-semibold">
            + Nuevo vídeo
          </button>
        </div>
        <h2 className="text-lg font-semibold mb-3 text-zinc-300">Proyectos</h2>
        {items === null && <p className="text-zinc-500">Cargando…</p>}
        {items?.length === 0 && <p className="text-zinc-500">Todavía no hay proyectos. Empieza subiendo uno o varios clips.</p>}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {items?.map((it) => (
            <button
              key={it.name}
              onClick={() => !it.error && go({view: 'editor', name: it.name})}
              className="text-left bg-zinc-900 rounded-xl overflow-hidden border border-zinc-800 hover:border-pink-500"
            >
              <div className="aspect-video bg-zinc-800">
                {it.thumbnail && <img src={fileUrl(it.name, it.thumbnail)} className="w-full h-full object-cover" alt="" />}
              </div>
              <div className="p-3">
                <div className="font-semibold truncate">{it.name}</div>
                {it.error ? (
                  <div className="text-red-400 text-xs">{it.error}</div>
                ) : (
                  <div className="text-xs text-zinc-400">
                    {it.clips} clip(s) · {fmt(it.duration ?? 0)}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
