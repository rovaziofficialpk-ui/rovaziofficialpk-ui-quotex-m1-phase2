export function InfoCards() {
  return (
    <>
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <h3 className="text-xs text-green-400 uppercase tracking-wider font-mono mb-2">🧠 Phase 3 checks</h3>
        <ul className="text-[10px] text-slate-400 space-y-1.5 leading-relaxed">
          <li>• Local browser preflight checks resolution, contrast and visual detail before the API call.</li>
          <li>• Trend, momentum, structure and candle evidence are scored independently.</li>
          <li>• A directional result needs at least 3 of 4 evidence checks aligned.</li>
          <li>• Optional M5/H1 context can block a signal when it conflicts with M1.</li>
          <li>• Confidence remains AI setup confidence—not a measured win probability.</li>
        </ul>
      </div>
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <h3 className="text-xs text-slate-500 uppercase tracking-wider font-mono mb-2">⚠️ Disclaimer</h3>
        <p className="text-[10px] text-slate-500 leading-relaxed">Educational chart analysis only. Binary options carry substantial risk. The tool can reject weak inputs and contradictory evidence, but it cannot establish a guaranteed trading edge.</p>
      </div>
    </>
  );
}
