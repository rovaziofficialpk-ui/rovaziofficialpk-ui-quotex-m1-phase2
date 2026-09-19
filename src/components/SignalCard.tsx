import { useState } from 'react';
import type { TradeBias, TradeSignal } from '../signalLogic';

const biasConfig: Record<TradeBias, { bg: string; border: string; text: string; glow: string; icon: string; label: string; sublabel: string }> = {
  CALL: { bg: 'from-green-500 to-emerald-600', border: 'border-green-400', text: 'text-green-400', glow: 'shadow-green-500/50', icon: '📈', label: 'CALL (UP)', sublabel: 'Bullish setup' },
  PUT: { bg: 'from-red-500 to-rose-600', border: 'border-red-400', text: 'text-red-400', glow: 'shadow-red-500/50', icon: '📉', label: 'PUT (DOWN)', sublabel: 'Bearish setup' },
  NEUTRAL: { bg: 'from-yellow-500 to-amber-600', border: 'border-yellow-400', text: 'text-yellow-400', glow: 'shadow-yellow-500/50', icon: '⚖️', label: 'NEUTRAL', sublabel: 'No actionable setup' },
};

interface SignalCardProps {
  signal: TradeSignal;
  onRetry: () => void;
  analyzing: boolean;
  minConfidence: number;
}

export function SignalCard({ signal, onRetry, analyzing, minConfidence }: SignalCardProps) {
  const [showRaw, setShowRaw] = useState(false);
  const cfg = biasConfig[signal.bias];
  const blocked = Boolean(signal.gateReason);

  return (
    <div className={`rounded-xl overflow-hidden border-2 ${cfg.border} shadow-2xl ${cfg.glow}`}>
      <div className={`bg-gradient-to-r ${cfg.bg} p-6 text-center relative overflow-hidden`}>
        <div className="relative">
          <div className="text-5xl mb-2">{cfg.icon}</div>
          <div className="text-xs uppercase tracking-widest opacity-80 mb-1">Final gated result</div>
          <div className="text-4xl md:text-5xl font-black tracking-tight">{cfg.label}</div>
          <div className="text-sm opacity-90 mt-1">{cfg.sublabel}</div>
        </div>
      </div>

      <div className="bg-[#0f1424] p-5 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-800">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Asset</div>
            <div className="text-lg font-bold font-mono truncate">{signal.pair}</div>
          </div>
          <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-800">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">AI Setup Confidence</div>
            <div className="flex items-baseline gap-1"><span className={`text-3xl font-black ${cfg.text}`}>{signal.confidence}</span><span className={`text-lg font-bold ${cfg.text}`}>%</span></div>
            <div className="mt-1 h-1.5 bg-slate-800 rounded-full overflow-hidden"><div className={`h-full bg-gradient-to-r ${cfg.bg}`} style={{ width: `${signal.confidence}%` }} /></div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Status label="Timeframe" value={signal.timeframe === 'M1' ? '✓ M1' : signal.timeframe === 'other' ? '⚠ Other' : '? Unknown'} ok={signal.timeframe === 'M1'} />
          <Status label="Chart Quality" value={signal.chartQuality.toUpperCase()} ok={signal.chartQuality !== 'poor'} />
          <Status label="Gate" value={blocked ? 'BLOCKED' : 'PASSED'} ok={!blocked} />
        </div>

        {blocked && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
            <div className="text-xs text-yellow-400 font-bold mb-1">🛡️ SIGNAL GATE OVERRIDE</div>
            <div className="text-xs text-yellow-100">{signal.gateReason}</div>
            {signal.proposedBias !== 'NEUTRAL' && <div className="text-[10px] text-slate-400 mt-1">AI proposed {signal.proposedBias}; the app forced NEUTRAL.</div>}
          </div>
        )}

        <Detail label="📊 Pattern Detected" text={signal.pattern} />
        <div className="bg-gradient-to-br from-yellow-500/10 to-orange-500/10 rounded-lg p-3 border border-yellow-500/30">
          <div className="text-[10px] text-yellow-400 uppercase tracking-wider mb-1 font-bold">🛑 Analysis / Entry Context</div>
          <div className="text-sm text-slate-200 leading-relaxed">{signal.entry}</div>
        </div>

        {signal.confidence < minConfidence && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-300">
            ⚠️ {signal.confidence}% is below your persisted {minConfidence}% gate.
          </div>
        )}

        {signal.warnings.length > 0 && (
          <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-800">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">⚠️ Analysis Limitations</div>
            <ul className="text-xs text-slate-300 space-y-1">{signal.warnings.map((warning, index) => <li key={`${warning}-${index}`}>• {warning}</li>)}</ul>
          </div>
        )}

        {signal.rawResponse && (
          <div className="bg-slate-900/60 rounded-lg border border-slate-800">
            <button onClick={() => setShowRaw((value) => !value)} className="w-full px-3 py-2 text-left text-xs text-slate-400 hover:text-slate-200 cursor-pointer flex items-center justify-between">
              <span>🧾 Raw structured output</span><span>{showRaw ? '▼' : '▶'}</span>
            </button>
            {showRaw && <pre className="px-3 pb-3 border-t border-slate-800 pt-2 text-[10px] text-slate-400 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto">{signal.rawResponse}</pre>}
          </div>
        )}

        <div className="pt-2">
          <button onClick={onRetry} disabled={analyzing} className="w-full px-4 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-md text-sm font-semibold cursor-pointer disabled:opacity-50">🔄 Re-analyze same chart</button>
        </div>
      </div>
    </div>
  );
}

function Status({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return <div className="bg-slate-900/60 rounded-lg p-2.5 border border-slate-800"><div className="text-[9px] text-slate-500 uppercase tracking-wider">{label}</div><div className={`text-xs font-bold mt-1 ${ok ? 'text-green-400' : 'text-yellow-400'}`}>{value}</div></div>;
}

function Detail({ label, text }: { label: string; text: string }) {
  return <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-800"><div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</div><div className="text-sm font-semibold">{text}</div></div>;
}
