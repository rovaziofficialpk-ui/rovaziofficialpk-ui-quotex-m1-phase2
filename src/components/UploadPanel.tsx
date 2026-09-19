import type { ChangeEvent } from 'react';

interface UploadPanelProps {
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function UploadPanel({ onUpload }: UploadPanelProps) {
  return (
    <div>
      <div className="text-center mb-6">
        <h2 className="text-3xl font-black mb-2">Upload <span className="text-green-400">M1 Chart</span></h2>
        <p className="text-sm text-slate-400">Structured CALL / PUT / NEUTRAL analysis with a hard application-side safety gate</p>
      </div>

      <label className="block cursor-pointer">
        <div className="border-2 border-dashed border-slate-700 hover:border-green-400 rounded-xl p-10 text-center transition-all group bg-slate-900/30">
          <div className="text-6xl mb-3 group-hover:scale-110 transition-transform">📊</div>
          <p className="text-lg font-bold mb-1">Drop M1 Chart Screenshot</p>
          <p className="text-sm text-slate-500">Quotex, TradingView, MT4, or another clear chart source</p>
          <div className="inline-block mt-4 px-6 py-2.5 bg-green-500 hover:bg-green-400 text-black font-bold rounded-md transition-colors">SELECT IMAGE</div>
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-500">
            <span>or</span><kbd className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-400 font-mono">Ctrl+V</kbd><span>to paste</span>
          </div>
          <input type="file" accept="image/*" onChange={onUpload} className="hidden" />
        </div>
      </label>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-8">
        {[
          ['📤', 'Upload', 'Clear M1 screenshot'],
          ['🧠', 'Analyze', 'Structured vision output'],
          ['🛡️', 'Validate', 'Timeframe + quality gate'],
          ['🗂️', 'Track', 'Persistent local history'],
        ].map(([icon, title, desc], index) => (
          <div key={title} className="bg-slate-900/50 border border-slate-800 rounded-lg p-3 text-center">
            <div className="text-2xl mb-1">{icon}</div>
            <div className="text-xs text-slate-500">STEP {index + 1}</div>
            <div className="font-bold text-sm">{title}</div>
            <div className="text-xs text-slate-400">{desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
