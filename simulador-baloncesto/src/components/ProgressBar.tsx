export default function ProgressBar({ value, max }: { value: number; max: number }) {
  const p = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden" role="progressbar" aria-valuenow={Math.round(p * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full bg-acento transition-[width] duration-150" style={{ width: `${p * 100}%` }} />
    </div>
  );
}
