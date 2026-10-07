import {useEffect, useState} from 'react';
import {api} from './api';
import {Home} from './components/Home';
import {ImportFlow} from './components/ImportFlow';
import {EditorView} from './components/EditorView';

export interface Status {
  ai: boolean;
  model: string | null;
  ffmpeg: boolean;
  node: boolean;
  message: string | null;
}

type Route = {view: 'home'} | {view: 'import'} | {view: 'editor'; name: string};

function parseHash(): Route {
  const h = decodeURIComponent(window.location.hash.slice(1));
  if (h.startsWith('/proyecto/')) return {view: 'editor', name: h.slice('/proyecto/'.length)};
  if (h === '/importar') return {view: 'import'};
  return {view: 'home'};
}

export function go(route: Route) {
  window.location.hash = route.view === 'editor' ? `/proyecto/${encodeURIComponent(route.name)}` : route.view === 'import' ? '/importar' : '/';
}

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    api.get<Status>('/api/status').then(setStatus).catch(() => setStatus(null));
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return (
    <div className="h-full flex flex-col">
      {status && !status.ai && (
        <div className="bg-amber-900/60 text-amber-100 text-sm px-4 py-1.5 border-b border-amber-700">⚠️ {status.message}</div>
      )}
      {status && !status.ffmpeg && <div className="bg-red-900 text-sm px-4 py-1.5">FFmpeg no está instalado: la importación y el render no funcionarán.</div>}
      <div className="flex-1 min-h-0">
        {route.view === 'home' && <Home />}
        {route.view === 'import' && <ImportFlow />}
        {route.view === 'editor' && <EditorView key={route.name} name={route.name} status={status} />}
      </div>
    </div>
  );
}
