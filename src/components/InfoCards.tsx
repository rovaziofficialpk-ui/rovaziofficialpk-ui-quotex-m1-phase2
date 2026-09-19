export function InfoCards() {
  return (
    <>
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <h3 className="text-xs text-green-400 uppercase tracking-wider font-mono mb-2">📡 Live-tab workflow</h3>
        <ul className="text-[10px] text-slate-400 space-y-1.5 leading-relaxed">
          <li>• Click Add Live Tab and choose the chart tab in the browser picker.</li>
          <li>• Keep the shared chart open; the app does not capture continuously.</li>
          <li>• Every Analyze click captures a fresh frame before the AI request.</li>
          <li>• Local preflight can reject an unreadable live frame before API usage.</li>
          <li>• The browser can stop sharing at any time from its own sharing indicator.</li>
        </ul>
      </div>
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <h3 className="text-xs text-slate-500 uppercase tracking-wider font-mono mb-2">⚠️ Disclaimer</h3>
        <p className="text-[10px] text-slate-500 leading-relaxed">Educational chart analysis only. Browser tab capture only reads the surface you explicitly share. AI confidence and confirmation scores are not measured probabilities of profit.</p>
      </div>
    </>
  );
}
