interface HeaderProps {
  hasImage: boolean;
  onNew: () => void;
  liveTabActive?: boolean;
}

export function Header({ hasImage, onNew, liveTabActive = false }: HeaderProps) {
  return (
    <header className="bg-[#0f1424]/95 backdrop-blur border-b border-slate-800 sticky top-0 z-50">
      <div className="max-w-[1400px] mx-auto px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-8 h-8 bg-gradient-to-br from-green-400 via-blue-500 to-purple-600 rounded-lg flex items-center justify-center font-black text-sm">Q</div>
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full animate-pulse" />
          </div>
          <div>
            <h1 className="text-sm font-black tracking-tight">QUOTEX <span className="text-green-400">1M</span> BOT</h1>
            <p className="hidden md:block text-[8px] text-slate-600 uppercase tracking-widest">Reproducible input audit · neutral until proven</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {liveTabActive && (
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-green-500/10 rounded-md border border-green-500/30">
              <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
              <span className="text-[10px] text-green-400 font-mono">LIVE TAB</span>
            </div>
          )}
          {hasImage && (
            <button onClick={onNew} className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 rounded-md transition-colors cursor-pointer">← New</button>
          )}
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-slate-800/50 rounded-md border border-slate-700">
            <div className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
            <span className="text-[10px] text-slate-400 font-mono">PHASE 4A.3</span>
          </div>
        </div>
      </div>
    </header>
  );
}
