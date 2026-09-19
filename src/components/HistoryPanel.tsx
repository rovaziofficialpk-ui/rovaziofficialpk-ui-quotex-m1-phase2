import type { SignalHistoryItem, TradeBias } from '../signalLogic';

const colors: Record<TradeBias, string> = { CALL: 'text-green-400', PUT: 'text-red-400', NEUTRAL: 'text-yellow-400' };

interface HistoryPanelProps {
  history: SignalHistoryItem[];
  onDelete: (id: string) => void;
  onClear: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
}

export function HistoryPanel({ history, onDelete, onClear, onExportJson, onExportCsv }: HistoryPanelProps) {
  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-xs text-slate-500 uppercase tracking-wider font-mono">Signal History</h3>
          <p className="text-[9px] text-slate-600 mt-1">Persisted locally • {history.length}/100</p>
        </div>
        {history.length > 0 && <button onClick={onClear} className="text-[9px] text-red-400/80 hover:text-red-300">Clear all</button>}
      </div>

      {history.length === 0 ? (
        <p className="text-xs text-slate-600 text-center py-5">No saved analyses yet</p>
      ) : (
        <>
          <div className="flex gap-2 mb-3">
            <button onClick={onExportJson} className="flex-1 px-2 py-1.5 text-[10px] bg-slate-800 hover:bg-slate-700 rounded">Export JSON</button>
            <button onClick={onExportCsv} className="flex-1 px-2 py-1.5 text-[10px] bg-slate-800 hover:bg-slate-700 rounded">Export CSV</button>
          </div>
          <div className="space-y-2 max-h-[430px] overflow-y-auto pr-1">
            {history.map((item) => (
              <div key={item.id} className="p-2.5 rounded-md border border-slate-800 bg-slate-900/60 group">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-slate-300 truncate">{item.pair}</div>
                    <div className="text-[9px] text-slate-600 mt-0.5">{new Date(item.createdAt).toLocaleString()}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-black ${colors[item.bias]}`}>{item.bias}</span>
                    <button aria-label="Delete history item" onClick={() => onDelete(item.id)} className="text-slate-600 hover:text-red-400 text-xs opacity-70 group-hover:opacity-100">×</button>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2 gap-3">
                  <span className="text-[10px] text-slate-500 truncate">{item.pattern}</span>
                  <span className={`text-[10px] font-bold ${colors[item.bias]}`}>{item.confidence}%</span>
                </div>
                <div className="flex justify-between mt-1 text-[9px] text-slate-600"><span>Gate {item.minConfidence}%</span><span>{(item.responseTimeMs / 1000).toFixed(2)}s</span></div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
