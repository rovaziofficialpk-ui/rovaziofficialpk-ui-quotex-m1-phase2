export function InfoCards() {
  return (
    <>
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <h3 className="text-xs text-green-400 uppercase tracking-wider font-mono mb-2">📡 Smart live monitoring</h3>
        <ul className="text-[10px] text-slate-400 space-y-1.5 leading-relaxed">
          <li>• Click Add Live Tab, then use Smart Auto Test to watch for meaningful chart changes.</li>
          <li>• The adaptive change detector skips near-duplicate frames before AI usage.</li>
          <li>• Auto Test uses a 15s AI cooldown, local quality gate, and Phase 3 evidence gate.</li>
          <li>• Two matching non-neutral auto results are tracked as a stronger stability streak, not a guaranteed outcome.</li>
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
