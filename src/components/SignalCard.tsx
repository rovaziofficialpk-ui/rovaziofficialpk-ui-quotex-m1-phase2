import type { TradeBias, TradeSignal } from '../signalLogic';

const biasConfig: Record<TradeBias, { border: string; text: string; bg: string; icon: string; label: string }> = {
  CALL: { border: 'border-green-500/50', text: 'text-green-400', bg: 'bg-green-500/10', icon: '▲', label: 'CALL' },
  PUT: { border: 'border-red-500/50', text: 'text-red-400', bg: 'bg-red-500/10', icon: '▼', label: 'PUT' },
  NEUTRAL: { border: 'border-yellow-500/50', text: 'text-yellow-400', bg: 'bg-yellow-500/10', icon: '◆', label: 'NEUTRAL' },
};

interface SignalCardProps {
  signal: TradeSignal;
  onRetry: () => void;
  analyzing: boolean;
  minConfidence: number;
}

export function SignalCard({ signal, onRetry, analyzing, minConfidence }: SignalCardProps) {
  const cfg = biasConfig[signal.bias];
  const blocked = Boolean(signal.gateReason);

  return (
    <div className={`overflow-hidden rounded-xl border ${cfg.border} bg-[#0d1322]`}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <div className={`flex h-10 min-w-[108px] items-center justify-center gap-2 rounded-lg ${cfg.bg} ${cfg.text}`}>
          <span className="text-xl font-black">{cfg.icon}</span>
          <span className="text-xl font-black tracking-tight">{cfg.label}</span>
        </div>

        <div className="min-w-[120px] flex-1">
          <div className="truncate text-xs font-black text-slate-200">{signal.pair}</div>
          <div className="truncate text-[10px] text-slate-500">{signal.pattern}</div>
        </div>

        <Metric label="Confidence" value={`${signal.confidence}%`} tone={cfg.text} />
        <Metric label="Confirm" value={`${signal.confirmationCount}/4`} tone={signal.confirmationCount >= 3 ? 'text-green-400' : 'text-yellow-400'} />
        <Metric label="Quality" value={`${signal.inputQualityScore}/100`} tone={signal.inputQualityStatus === 'pass' ? 'text-green-400' : 'text-yellow-400'} />
        <Metric label="Gate" value={blocked ? 'BLOCK' : 'PASS'} tone={blocked ? 'text-yellow-400' : 'text-green-400'} />

        <button onClick={onRetry} disabled={analyzing} className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[10px] font-bold text-slate-300 hover:bg-slate-700 disabled:opacity-50">
          ↻ Analyze
        </button>
      </div>

      {blocked && (
        <div className="border-t border-yellow-500/20 bg-yellow-500/5 px-3 py-1.5 text-[10px] text-yellow-200">
          <span className="font-black text-yellow-400">Gate override:</span> {signal.gateReason}
        </div>
      )}

      <details className="group border-t border-slate-800/80">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">
          <span>Signal details</span>
          <span className="group-open:rotate-90">›</span>
        </summary>
        <div className="grid gap-2 border-t border-slate-800 p-3 lg:grid-cols-3">
          <div className="grid grid-cols-4 gap-1.5 lg:col-span-3">
            <Pill label="Trend" value={signal.trend} />
            <Pill label="Momentum" value={signal.momentum} />
            <Pill label="Structure" value={signal.structure} />
            <Pill label="Candle" value={signal.candleSignal} />
          </div>
          <Detail label="Entry context" text={signal.entry} />
          <Detail label="Support / resistance" text={signal.supportResistance} />
          <Detail label="Higher timeframe" text={signal.contextNotes || 'No M5/H1 context supplied.'} />
          {signal.evidence.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2 lg:col-span-2">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-600">Visible evidence</div>
              <div className="mt-1 text-[10px] leading-relaxed text-slate-300">{signal.evidence.join(' • ')}</div>
            </div>
          )}
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-600">Validation</div>
            <div className="mt-1 text-[10px] text-slate-300">
              {signal.timeframe.toUpperCase()} · {signal.chartQuality.toUpperCase()} · gate {minConfidence}% · context {signal.contextAlignment.replace('_', ' ')}
            </div>
            {signal.warnings.length > 0 && <div className="mt-1 text-[9px] text-yellow-400">{signal.warnings.join(' • ')}</div>}
          </div>
        </div>
      </details>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="min-w-[66px] rounded-md border border-slate-800 bg-slate-900/65 px-2 py-1">
      <div className="text-[8px] uppercase tracking-wider text-slate-600">{label}</div>
      <div className={`text-xs font-black ${tone}`}>{value}</div>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  const tone = value === 'bullish' ? 'text-green-400' : value === 'bearish' ? 'text-red-400' : 'text-yellow-400';
  return <div className="rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1"><div className="text-[8px] uppercase text-slate-600">{label}</div><div className={`text-[10px] font-black capitalize ${tone}`}>{value}</div></div>;
}

function Detail({ label, text }: { label: string; text: string }) {
  return <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2"><div className="text-[9px] font-bold uppercase tracking-wider text-slate-600">{label}</div><div className="mt-1 text-[10px] leading-relaxed text-slate-300">{text}</div></div>;
}
