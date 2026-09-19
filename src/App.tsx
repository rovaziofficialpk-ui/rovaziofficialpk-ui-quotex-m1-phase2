import { useEffect, useState, type ChangeEvent } from 'react';
import { ApiKeyPanel } from './components/ApiKeyPanel';
import { Header } from './components/Header';
import { HistoryPanel } from './components/HistoryPanel';
import { InfoCards } from './components/InfoCards';
import { SignalCard } from './components/SignalCard';
import { UploadPanel } from './components/UploadPanel';
import { analyzeChartWithGroq, humanizeGroqError, testGroqConnection } from './services/groq';
import { clearApiKey, HISTORY_LIMIT, loadApiKey, loadHistory, loadSettings, saveApiKey, saveHistory, saveSettings } from './services/storage';
import { createHistoryItem, type SignalHistoryItem, type TradeSignal } from './signalLogic';
import { exportHistoryCsv, exportHistoryJson } from './utils/exportHistory';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function App() {
  const [apiKey, setApiKey] = useState(() => loadApiKey());
  const [image, setImage] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [signal, setSignal] = useState<TradeSignal | null>(null);
  const [error, setError] = useState('');
  const [responseTime, setResponseTime] = useState<number | null>(null);
  const [history, setHistory] = useState<SignalHistoryItem[]>(() => loadHistory());
  const [pasteToast, setPasteToast] = useState(false);
  const [minConfidence, setMinConfidence] = useState(() => loadSettings().minConfidence);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');

  useEffect(() => saveSettings({ minConfidence }), [minConfidence]);
  useEffect(() => saveHistory(history), [history]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (!item.type.startsWith('image/')) continue;
        event.preventDefault();
        const file = item.getAsFile();
        if (file) loadImageFile(file, true);
        break;
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const loadImageFile = (file: File, pasted = false) => {
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Image too large. Maximum size is 4 MB.');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      setImage(String(event.target?.result || ''));
      setSignal(null);
      setError('');
      setResponseTime(null);
      if (pasted) {
        setPasteToast(true);
        window.setTimeout(() => setPasteToast(false), 1800);
      }
    };
    reader.onerror = () => setError('Could not read this image. Try another file.');
    reader.readAsDataURL(file);
  };

  const handleImageUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) loadImageFile(file);
    event.target.value = '';
  };

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    saveApiKey(value);
    setTestState('idle');
  };

  const handleApiKeyClear = () => {
    setApiKey('');
    clearApiKey();
    setTestState('idle');
  };

  const handleTestConnection = async () => {
    if (!apiKey.trim()) return;
    setTestState('testing');
    setError('');
    try {
      await testGroqConnection(apiKey);
      setTestState('ok');
    } catch (err) {
      setTestState('error');
      setError(humanizeGroqError(err));
    }
  };

  const analyzeChart = async () => {
    if (!apiKey.trim()) {
      setError('Add your Groq API key first.');
      return;
    }
    if (!image) {
      setError('Upload or paste an M1 chart screenshot first.');
      return;
    }

    setAnalyzing(true);
    setError('');
    setSignal(null);
    setResponseTime(null);
    try {
      const result = await analyzeChartWithGroq({ apiKey, image, minConfidence });
      setSignal(result.signal);
      setResponseTime(result.responseTimeMs);
      const historyItem = createHistoryItem(result.signal, result.responseTimeMs, minConfidence);
      setHistory((current) => [historyItem, ...current].slice(0, HISTORY_LIMIT));
    } catch (err) {
      setError(humanizeGroqError(err));
    } finally {
      setAnalyzing(false);
    }
  };

  const reset = () => {
    setImage(null);
    setSignal(null);
    setError('');
    setResponseTime(null);
  };

  const deleteHistoryItem = (id: string) => setHistory((current) => current.filter((item) => item.id !== id));
  const clearHistory = () => {
    if (window.confirm('Clear all locally saved signal history?')) setHistory([]);
  };

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white">
      <Header hasImage={Boolean(image)} onNew={reset} />

      <main className="max-w-6xl mx-auto px-4 py-6">
        <ApiKeyPanel apiKey={apiKey} onChange={handleApiKeyChange} onClear={handleApiKeyClear} onTest={handleTestConnection} testState={testState} />

        {!image ? (
          <UploadPanel onUpload={handleImageUpload} />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-slate-500 uppercase tracking-wider font-mono">Chart Input</div>
                  {responseTime !== null && <div className="text-xs font-mono text-green-400">⚡ {(responseTime / 1000).toFixed(2)}s</div>}
                </div>
                <div className="relative bg-black rounded-lg overflow-hidden">
                  <img src={image} alt="Uploaded chart" className="w-full h-auto max-h-[500px] object-contain" />
                  {analyzing && (
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center">
                      <div className="text-center">
                        <div className="relative w-20 h-20 mx-auto mb-3"><div className="absolute inset-0 border-4 border-green-400/30 rounded-full" /><div className="absolute inset-0 border-4 border-green-400 border-t-transparent rounded-full animate-spin" /><div className="absolute inset-0 flex items-center justify-center text-2xl">🎯</div></div>
                        <p className="font-bold text-lg">Analyzing M1 Chart…</p>
                        <p className="text-xs text-slate-400 mt-1 font-mono">Structured output • validation • hard gate</p>
                      </div>
                    </div>
                  )}
                </div>

                {!analyzing && !signal && (
                  <div className="mt-3 space-y-3">
                    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                      <div className="flex items-center justify-between mb-2"><label className="text-xs text-slate-400 font-semibold">🎚️ Min Confidence Threshold</label><span className="text-sm font-bold text-green-400">{minConfidence}%</span></div>
                      <input type="range" min="50" max="90" value={minConfidence} onChange={(event: ChangeEvent<HTMLInputElement>) => setMinConfidence(Number(event.target.value))} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-green-500" />
                      <p className="text-[10px] text-slate-500 mt-1">Persisted automatically. CALL/PUT below this value becomes NEUTRAL. It is not a win-probability setting.</p>
                    </div>
                    <button onClick={() => void analyzeChart()} disabled={!apiKey.trim()} className="w-full px-6 py-4 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 disabled:from-slate-700 disabled:to-slate-800 text-white font-black rounded-lg transition-all cursor-pointer disabled:cursor-not-allowed text-lg shadow-lg shadow-green-500/20">🎯 GENERATE ANALYSIS</button>
                  </div>
                )}
              </div>

              {signal && <SignalCard signal={signal} onRetry={() => void analyzeChart()} analyzing={analyzing} minConfidence={minConfidence} />}
            </div>

            <div className="space-y-4">
              <HistoryPanel history={history} onDelete={deleteHistoryItem} onClear={clearHistory} onExportJson={() => exportHistoryJson(history)} onExportCsv={() => exportHistoryCsv(history)} />
              <InfoCards />
            </div>
          </div>
        )}

        {error && <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-4"><p className="text-red-400 font-bold text-sm mb-1">❌ Error</p><p className="text-red-300 text-xs">{error}</p></div>}
      </main>

      {pasteToast && <div className="fixed bottom-6 right-6 bg-green-500 text-black px-4 py-2 rounded-lg shadow-lg font-bold text-sm z-50">✅ Image pasted</div>}

      <footer className="border-t border-slate-900 py-4 mt-8"><div className="max-w-6xl mx-auto px-4 text-center text-[10px] text-slate-600">Groq + Qwen 3.8 vision • Local persistence • Educational analysis only • Not financial advice</div></footer>
    </div>
  );
}

export default App;
