import type { ChangeEvent } from 'react';

export type AutoTestStatus = 'idle' | 'watching' | 'capturing' | 'preflight' | 'analyzing' | 'cooldown' | 'quality-block' | 'error';

export interface AutoTestStats {
  status: AutoTestStatus;
  checks: number;
  aiRuns: number;
  skippedSimilar: number;
  skippedCooldown: number;
  qualityBlocks: number;
  errors: number;
  lastChangeScore: number | null;
  lastBias: string | null;
  stableStreak: number;
  lastRunAt: number | null;
}

interface AutoTestPanelProps {
  enabled: boolean;
  canStart: boolean;
  busy: boolean;
  intervalSeconds: number;
  stats: AutoTestStats;
  onToggle: () => void;
  onIntervalChange: (seconds: number) => void;
}

const statusLabel: Record<AutoTestStatus, string> = {
  idle: 'IDLE',
  watching: 'WATCHING',
  capturing: 'CAPTURING',
  preflight: 'QUALITY CHECK',
  analyzing: 'AI ANALYSIS',
  cooldown: 'COOLDOWN',
  'quality-block': 'QUALITY BLOCK',
  error: 'ERROR',
};

export function AutoTestPanel({ enabled, canStart, busy, intervalSeconds, stats, onToggle, onIntervalChange }: AutoTestPanelProps) {
  const skipped = stats.skippedSimilar + stats.skippedCooldown + stats.qualityBlocks;
  const stability = stats.lastBias && stats.lastBias !== 'NEUTRAL'
    ? `${stats.lastBias} ×${Math.max(1, stats.stableStreak)}`
    : stats.lastBias || '—';

  return (
    <div className={`rounded-xl border p-3 ${enabled ? 'border-cyan-400/40 bg-cyan-500/5' : 'border-slate-700 bg-slate-800/40'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${enabled ? 'bg-cyan-400 animate-pulse' : 'bg-slate-600'}`} />
            <div className="text-xs font-black uppercase tracking-wider text-cyan-300">Smart Auto Test</div>
            <span className="rounded-full bg-slate-900/70 px-2 py-0.5 text-[9px] font-bold text-slate-400">{statusLabel[stats.status]}</span>
          </div>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
            Adaptive frame-change detection skips near-duplicates. Meaningful changes pass local quality checks, a 15s AI cooldown, then the full Phase 3 evidence gate. No trades are placed.
          </p>
        </div>

        <button
          onClick={onToggle}
          disabled={!enabled && (!canStart || busy)}
          className={`rounded-lg px-4 py-2 text-xs font-black transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${enabled ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25' : 'bg-cyan-400 text-slate-950 hover:bg-cyan-300'}`}
        >
          {enabled ? '■ STOP AUTO TEST' : '⚡ START AUTO TEST'}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-6">
        <Metric label="Frame checks" value={String(stats.checks)} />
        <Metric label="AI tests" value={String(stats.aiRuns)} />
        <Metric label="Skipped" value={String(skipped)} />
        <Metric label="Change score" value={stats.lastChangeScore === null ? '—' : stats.lastChangeScore.toFixed(2)} />
        <Metric label="Signal stability" value={stability} />
        <Metric label="Errors" value={String(stats.errors)} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-700/70 pt-3">
        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          <span>Capture every</span>
          <select
            value={intervalSeconds}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => onIntervalChange(Number(event.target.value))}
            disabled={enabled}
            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-300 disabled:opacity-50"
          >
            {[3, 5, 10, 15, 30].map((seconds) => <option key={seconds} value={seconds}>{seconds}s</option>)}
          </select>
          <span>• recommended: 5s</span>
        </div>
        <div className="text-[9px] text-slate-600">Change gate 2.5 • AI cooldown 15s • circuit breaker after 3 consecutive failures</div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 px-2.5 py-2">
      <div className="text-[8px] uppercase tracking-wider text-slate-600">{label}</div>
      <div className="mt-0.5 truncate text-xs font-black text-slate-300">{value}</div>
    </div>
  );
}
