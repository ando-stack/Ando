import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CompetitionId } from '../../engine/datatypes';
import type { TeamSetup } from '../../engine/prepare';
import { defaultTeamSetup } from '../../engine/prepare';
import { loadSnapshot, type LoadedSnapshot } from './data';
import type { SimRun } from './types';

interface Selection {
  comp: CompetitionId;
  homeId: string | null;
  awayId: string | null;
  homeSetup: TeamSetup | null;
  awaySetup: TeamSetup | null;
  /** Bajas marcadas (ids) por equipo; los jugadores de baja no juegan. */
  homeOut: string[];
  awayOut: string[];
  n: number;
  seed: number;
}

interface AppState {
  sel: Selection;
  setSel: (u: Partial<Selection>) => void;
  loaded: LoadedSnapshot | null;
  loadError: string | null;
  loading: boolean;
  run: SimRun | null;
  setRun: (r: SimRun | null) => void;
  showOdds: boolean;
  setShowOdds: (v: boolean) => void;
  pickTeam: (side: 'home' | 'away', id: string | null) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [sel, setSelState] = useState<Selection>({
    comp: 'euroleague',
    homeId: null,
    awayId: null,
    homeSetup: null,
    awaySetup: null,
    homeOut: [],
    awayOut: [],
    n: 5000,
    seed: 20261023,
  });
  const [loaded, setLoaded] = useState<LoadedSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [run, setRun] = useState<SimRun | null>(null);
  const [showOdds, setShowOdds] = useState(false);

  const setSel = useCallback((u: Partial<Selection>) => setSelState((s) => ({ ...s, ...u })), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    setLoaded(null);
    loadSnapshot(sel.comp)
      .then((l) => alive && setLoaded(l))
      .catch((e) => alive && setLoadError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [sel.comp]);

  const pickTeam = useCallback(
    (side: 'home' | 'away', id: string | null) => {
      if (!loaded) return;
      const snap = loaded.snapshot;
      const setup = id ? defaultTeamSetup(snap, id) : null;
      const out = id
        ? snap.injuries.filter((i) => i.teamId === id && (i.status === 'baja' || i.status === 'ausente-reciente')).map((i) => i.playerId!).filter(Boolean)
        : [];
      if (side === 'home') setSel({ homeId: id, homeSetup: setup, homeOut: out });
      else setSel({ awayId: id, awaySetup: setup, awayOut: out });
    },
    [loaded, setSel],
  );

  const value = useMemo(
    () => ({ sel, setSel, loaded, loadError, loading, run, setRun, showOdds, setShowOdds, pickTeam }),
    [sel, setSel, loaded, loadError, loading, run, showOdds, pickTeam],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp fuera de AppProvider');
  return c;
}
