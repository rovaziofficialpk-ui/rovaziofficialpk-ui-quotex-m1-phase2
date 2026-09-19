export function InfoCards() {
  return (
    <>
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <h3 className="text-xs text-green-400 uppercase tracking-wider font-mono mb-2">💡 Better inputs</h3>
        <ul className="text-[10px] text-slate-400 space-y-1.5 leading-relaxed">
          <li>• Use a clear screenshot with readable candles and labels.</li>
          <li>• Keep recent price action and relevant levels visible.</li>
          <li>• Avoid excessive overlays that hide candle structure.</li>
          <li>• The selected threshold is a filter, not a win probability.</li>
          <li>• Review the AI reasoning and limitations before acting.</li>
        </ul>
      </div>
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <h3 className="text-xs text-slate-500 uppercase tracking-wider font-mono mb-2">⚠️ Disclaimer</h3>
        <p className="text-[10px] text-slate-500 leading-relaxed">Educational chart analysis only. Binary options carry substantial risk and AI-generated setup confidence is not a measured probability of profit.</p>
      </div>
    </>
  );
}
