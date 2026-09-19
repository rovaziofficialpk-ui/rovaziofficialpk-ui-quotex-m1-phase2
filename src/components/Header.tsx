interface HeaderProps {
  hasImage: boolean;
  onNew: () => void;
}

export function Header({ hasImage, onNew }: HeaderProps) {
  return (
    <header className="bg-[#0f1424]/95 backdrop-blur border-b border-slate-800 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 bg-gradient-to-br from-green-400 via-blue-500 to-purple-600 rounded-lg flex items-center justify-center font-black text-lg">Q</div>
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full animate-pulse" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight">QUOTEX <span className="text-green-400">1M</span> BOT</h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest">Structured chart-analysis prototype</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasImage && (
            <button onClick={onNew} className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 rounded-md transition-colors cursor-pointer">← New</button>
          )}
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-slate-800/50 rounded-md border border-slate-700">
            <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
            <span className="text-[10px] text-slate-400 font-mono">PHASE 2</span>
          </div>
        </div>
      </div>
    </header>
  );
}
