import type { ImagePreflightResult } from '../services/imagePreflight';

interface ImagePreflightPanelProps {
  result: ImagePreflightResult | null;
  loading: boolean;
}

export function ImagePreflightPanel({ result, loading }: ImagePreflightPanelProps) {
  if (loading) {
    return <div className="rounded-lg border border-slate-800 bg-slate-900/55 px-2.5 py-2 text-[10px] font-bold text-slate-400">🔎 Checking frame quality…</div>;
  }
  if (!result) return null;

  const tone = result.status === 'pass'
    ? 'text-green-400 border-green-500/30'
    : result.status === 'warn'
      ? 'text-yellow-400 border-yellow-500/30'
      : 'text-red-400 border-red-500/30';

  return (
    <details className={`group rounded-lg border bg-slate-900/55 ${tone}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[10px] font-black uppercase">{result.status === 'pass' ? '✓ Quality pass' : result.status === 'warn' ? '⚠ Quality review' : '✕ Quality block'}</span>
          <span className="text-[9px] text-slate-500">{result.score}/100 · {result.width}×{result.height}</span>
        </div>
        <span className="text-[9px] text-slate-600 group-open:rotate-90">›</span>
      </summary>
      <div className="grid grid-cols-3 gap-1 border-t border-slate-800 px-2.5 py-2 text-[9px]">
        <Metric label="Contrast" value={result.contrast.toFixed(1)} />
        <Metric label="Bright" value={result.brightness.toFixed(1)} />
        <Metric label="Aspect" value={result.aspectRatio.toFixed(2)} />
        {result.warnings.length > 0 && <div className="col-span-3 mt-1 text-[9px] leading-relaxed text-slate-400">{result.warnings.join(' • ')}</div>}
      </div>
    </details>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded bg-black/20 px-1.5 py-1"><span className="text-slate-600">{label} </span><span className="font-mono text-slate-300">{value}</span></div>;
}
