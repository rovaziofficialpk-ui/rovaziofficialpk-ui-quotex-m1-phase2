import type { ImagePreflightResult } from '../services/imagePreflight';

interface ImagePreflightPanelProps {
  result: ImagePreflightResult | null;
  loading: boolean;
}

export function ImagePreflightPanel({ result, loading }: ImagePreflightPanelProps) {
  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
        <div className="text-xs text-slate-400 font-semibold">🔎 Inspecting screenshot quality…</div>
      </div>
    );
  }

  if (!result) return null;

  const statusClass = result.status === 'pass'
    ? 'text-green-400 border-green-500/30 bg-green-500/5'
    : result.status === 'warn'
      ? 'text-yellow-400 border-yellow-500/30 bg-yellow-500/5'
      : 'text-red-400 border-red-500/30 bg-red-500/5';

  const statusLabel = result.status === 'pass' ? 'PASS' : result.status === 'warn' ? 'REVIEW' : 'BLOCK';

  return (
    <div className={`rounded-lg p-3 border ${statusClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-80">Local Screenshot Preflight</div>
          <div className="font-black text-sm mt-0.5">{statusLabel} • {result.score}/100</div>
        </div>
        <div className="text-right text-[10px] opacity-80 font-mono">
          <div>{result.width}×{result.height}</div>
          <div>detail {Math.round(result.edgeDensity * 1000) / 10}%</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3 text-[10px]">
        <Metric label="Contrast" value={result.contrast.toFixed(1)} />
        <Metric label="Brightness" value={result.brightness.toFixed(1)} />
        <Metric label="Aspect" value={result.aspectRatio.toFixed(2)} />
      </div>

      {result.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-[10px] text-slate-300">
          {result.warnings.map((warning, index) => <li key={`${warning}-${index}`}>• {warning}</li>)}
        </ul>
      )}

      {result.status === 'block' && (
        <p className="mt-2 text-[10px] text-red-300">Analysis is disabled until a clearer screenshot is uploaded.</p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-black/20 border border-white/5 px-2 py-1.5">
      <div className="text-slate-500">{label}</div>
      <div className="font-mono text-slate-200">{value}</div>
    </div>
  );
}
