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
  capturing: 'CAPTURE',
  preflight: 'CHECK',
  analyzing: 'AI',
  cooldown: 'COOLDOWN',
  'quality-block': 'BLOCK',
  error: 'ERROR',
};

export function AutoTestPanel({ enabled, canStart, busy, intervalSeconds, stats, onToggle, onIntervalChange }: AutoTestPanelProps) {
  const skipped = stats.skippedSimilar + stats.skippedCooldown + stats.qualityBlocks;
  const stability = stats.lastBias && stats.lastBias !== 'NEUTRAL'
    ? `${stats.lastBias} ×${Math.max(1, stats.stableStreak)}`
    : stats.lastBias || '—';

  return (
    <div className={`rounded-lg border p-2.5 ${enabled ? 'border-cyan-400/40 bg-cyan-500/5' : 'border-slate-800 bg-slate-900/55'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${enabled ? 'bg-cyan-400 animate-pulse' : 'bg-slate-600'}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-cyan-300">Auto Test</span>
              <span className="rounded bg-slate-950/70 px-1.5 py-0.5 text-[8px] font-bold text-slate-500">{statusLabel[stats.status]}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <select
            value={intervalSeconds}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => onIntervalChange(Number(event.target.value))}
            disabled={enabled}
            className="rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-[9px] text-slate-400 disabled:opacity-50"
          >
            {[3, 5, 10, 15, 30].map((seconds) => <option key={seconds} value={seconds}>{seconds}s</option>)}
          </select>
          <button
            onClick={onToggle}
            disabled={!enabled && (!canStart || busy)}
            className={`rounded-md px-2.5 py-1.5 text-[10px] font-black disabled:cursor-not-allowed disabled:opacity-40 ${enabled ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25' : 'bg-cyan-400 text-slate-950 hover:bg-cyan-300'}`}
          >
            {enabled ? 'STOP' : 'START'}
          </button>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-5 gap-1">
        <Metric label="Checks" value={String(stats.checks)} />
        <Metric label="AI" value={String(stats.aiRuns)} />
        <Metric label="Skip" value={String(skipped)} />
        <Metric label="Change" value={stats.lastChangeScore === null ? '—' : stats.lastChangeScore.toFixed(1)} />
        <Metric label="Stable" value={stability} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded border border-slate-800 bg-slate-950/60 px-1.5 py-1 text-center"><div className="text-[7px] uppercase text-slate-600">{label}</div><div className="truncate text-[9px] font-black text-slate-300">{value}</div></div>;
}
