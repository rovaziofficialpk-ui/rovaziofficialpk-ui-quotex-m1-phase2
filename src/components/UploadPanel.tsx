import type { ChangeEvent } from 'react';

interface UploadPanelProps {
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onStartLiveTab: () => void;
  liveTabSupported: boolean;
  liveTabBusy: boolean;
}

export function UploadPanel({ onUpload, onStartLiveTab, liveTabSupported, liveTabBusy }: UploadPanelProps) {
  return (
    <div>
      <div className="text-center mb-6">
        <h2 className="text-3xl font-black mb-2">Analyze an <span className="text-green-400">M1 Chart</span></h2>
        <p className="text-sm text-slate-400">Use a live browser tab or upload a screenshot. Phase 3 checks every captured frame before AI analysis.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border-2 border-green-500/40 bg-gradient-to-br from-green-500/10 to-blue-500/5 p-8 text-center">
          <div className="text-6xl mb-3">🟢</div>
          <div className="inline-flex rounded-full border border-green-500/30 bg-green-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-green-400">Recommended</div>
          <p className="mt-3 text-lg font-black">Add Live Browser Tab</p>
          <p className="mt-1 text-sm text-slate-400">Choose your live Quotex, TradingView, or chart tab from the browser share picker.</p>
          <button
            onClick={onStartLiveTab}
            disabled={!liveTabSupported || liveTabBusy}
            className="mt-5 rounded-md bg-green-500 px-6 py-2.5 font-black text-black transition-colors hover:bg-green-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            {liveTabBusy ? 'OPENING PICKER…' : 'ADD LIVE TAB'}
          </button>
          <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
            The browser always asks you which tab/window to share. This site cannot silently access your other tabs.
          </p>
          {!liveTabSupported && <p className="mt-2 text-[10px] text-yellow-400">Live tab capture requires HTTPS and a modern browser with screen/tab sharing support.</p>}
        </div>

        <label className="block cursor-pointer">
          <div className="h-full border-2 border-dashed border-slate-700 hover:border-blue-400 rounded-xl p-8 text-center transition-all group bg-slate-900/30">
            <div className="text-6xl mb-3 group-hover:scale-110 transition-transform">📊</div>
            <p className="text-lg font-bold mb-1">Upload M1 Screenshot</p>
            <p className="text-sm text-slate-500">Use a saved screenshot instead of a live tab.</p>
            <div className="inline-block mt-5 px-6 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-md transition-colors">SELECT IMAGE</div>
            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-500"><span>or</span><kbd className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-400 font-mono">Ctrl+V</kbd><span>to paste</span></div>
            <input type="file" accept="image/*" onChange={onUpload} className="hidden" />
          </div>
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-8">
        {[
          ['📡', 'Connect', 'Live tab or screenshot'],
          ['📸', 'Capture', 'Fresh frame on Analyze'],
          ['🔬', 'Confirm', '4 evidence checks'],
          ['🛡️', 'Gate', 'Weak/conflicting → neutral'],
        ].map(([icon, title, desc], index) => (
          <div key={title} className="bg-slate-900/50 border border-slate-800 rounded-lg p-3 text-center">
            <div className="text-2xl mb-1">{icon}</div><div className="text-xs text-slate-500">STEP {index + 1}</div><div className="font-bold text-sm">{title}</div><div className="text-xs text-slate-400">{desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
