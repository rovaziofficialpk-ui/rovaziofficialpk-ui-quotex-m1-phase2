import type { LiveTabInfo } from '../services/tabCapture';

interface LiveTabPanelProps {
  info: LiveTabInfo | null;
  active: boolean;
  busy: boolean;
  onChangeTab: () => void;
  onStop: () => void;
}

export function LiveTabPanel({ info, active, busy, onChangeTab, onStop }: LiveTabPanelProps) {
  if (!active || !info) return null;

  return (
    <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-green-400" />
            <span className="text-[10px] font-black uppercase tracking-wider text-green-400">Live tab</span>
            <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-[8px] font-bold text-green-300">REAL-TIME</span>
          </div>
          <div className="mt-1 truncate text-[9px] text-slate-500">{info.label}</div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button onClick={onChangeTab} disabled={busy} className="rounded bg-blue-500/10 px-2 py-1 text-[9px] font-bold text-blue-300 hover:bg-blue-500/20 disabled:opacity-50">Change</button>
          <button onClick={onStop} disabled={busy} className="rounded bg-red-500/10 px-2 py-1 text-[9px] font-bold text-red-300 hover:bg-red-500/20 disabled:opacity-50">Stop</button>
        </div>
      </div>
    </div>
  );
}
