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
    <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-50" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-400" />
            </span>
            <span className="text-xs font-black uppercase tracking-wider text-green-400">Live tab connected</span>
          </div>
          <div className="mt-1 truncate text-xs text-slate-300">{info.label}</div>
          <div className="mt-0.5 text-[10px] text-slate-500">The main chart preview is now a continuous live feed. Analyze and Auto Test capture their own fresh still frames internally.</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-green-500/30 bg-green-500/10 px-2.5 py-1.5 text-[10px] font-bold text-green-300">● REAL-TIME PREVIEW</span>
          <button onClick={onChangeTab} disabled={busy} className="rounded-md bg-blue-500/15 px-2.5 py-1.5 text-[10px] font-semibold text-blue-300 hover:bg-blue-500/25 disabled:opacity-50">Change tab</button>
          <button onClick={onStop} disabled={busy} className="rounded-md bg-red-500/10 px-2.5 py-1.5 text-[10px] font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-50">Stop sharing</button>
        </div>
      </div>
    </div>
  );
}
