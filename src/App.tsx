import { useEffect, useState, type ChangeEvent } from 'react';
import { ApiKeyPanel } from './components/ApiKeyPanel';
import { ContextImagesPanel } from './components/ContextImagesPanel';
import { Header } from './components/Header';
import { HistoryPanel } from './components/HistoryPanel';
import { ImagePreflightPanel } from './components/ImagePreflightPanel';
import { InfoCards } from './components/InfoCards';
import { SignalCard } from './components/SignalCard';
import { UploadPanel } from './components/UploadPanel';
import { analyzeChartWithGroq, humanizeGroqError, testGroqConnection, type ContextImage, type ContextLabel } from './services/groq';
import { analyzeImagePreflight, type ImagePreflightResult } from './services/imagePreflight';
import { clearApiKey, HISTORY_LIMIT, loadApiKey, loadHistory, loadSettings, saveApiKey, saveHistory, saveSettings } from './services/storage';
import { createHistoryItem, type SignalHistoryItem, type TradeSignal } from './signalLogic';
import { exportHistoryCsv, exportHistoryJson } from './utils/exportHistory';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function App() {
  const [apiKey, setApiKey] = useState(() => loadApiKey());
  const [image, setImage] = useState<string | null>(null);
  const [contextImages, setContextImages] = useState<Record<ContextLabel, string | null>>({ M5: null, H1: null });
  const [preflight, setPreflight] = useState<ImagePreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
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
        if (file) void loadPrimaryImage(file, true);
        break;
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const validateImageFile = (file: File): string | null => {
    if (file.size > MAX_IMAGE_BYTES) return 'Image too large. Maximum size is 4 MB.';
    if (!file.type.startsWith('image/')) return 'Please select an image file.';
    return null;
  };

  const readImageFile = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(String(event.target?.result || ''));
    reader.onerror = () => reject(new Error('Could not read this image. Try another file.'));
    reader.readAsDataURL(file);
  });

  const loadPrimaryImage = async (file: File, pasted = false) => {
    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setPreflightLoading(true);
    setPreflight(null);
    setSignal(null);
    setResponseTime(null);
    setError('');

    try {
      const dataUrl = await readImageFile(file);
      setImage(dataUrl);
      const result = await analyzeImagePreflight(dataUrl);
      setPreflight(result);
      if (pasted) {
        setPasteToast(true);
        window.setTimeout(() => setPasteToast(false), 1800);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not inspect this image.');
    } finally {
      setPreflightLoading(false);
    }
  };

  const handleImageUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void loadPrimaryImage(file);
    event.target.value = '';
  };

  const handleContextUpload = async (label: ContextLabel, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const validationError = validateImageFile(file);
    if (validationError) {
      setError(`${label}: ${validationError}`);
      return;
    }

    try {
      const dataUrl = await readImageFile(file);
      setContextImages((current) => ({ ...current, [label]: dataUrl }));
      setSignal(null);
      setResponseTime(null);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not read the ${label} image.`);
    }
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
    if (!preflight) {
      setError('Wait for the local screenshot preflight to finish.');
      return;
    }
    if (preflight.status === 'block') {
      setError('This screenshot failed the local preflight. Upload a clearer M1 screenshot before analysis.');
      return;
    }

    const extraImages: ContextImage[] = (['M5', 'H1'] as ContextLabel[])
      .filter((label) => Boolean(contextImages[label]))
      .map((label) => ({ label, image: contextImages[label] as string }));

    setAnalyzing(true);
    setError('');
    setSignal(null);
    setResponseTime(null);
    try {
      const result = await analyzeChartWithGroq({
        apiKey,
        image,
        minConfidence,
        preflight,
        contextImages: extraImages,
      });
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
    setContextImages({ M5: null, H1: null });
    setPreflight(null);
    setPreflightLoading(false);
    setSignal(null);
    setError('');
    setResponseTime(null);
  };

  const deleteHistoryItem = (id: string) => setHistory((current) => current.filter((item) => item.id !== id));
  const clearHistory = () => {
    if (window.confirm('Clear all locally saved signal history?')) setHistory([]);
  };

  const canAnalyze = Boolean(apiKey.trim() && preflight && preflight.status !== 'block' && !preflightLoading);

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
                  <div className="text-xs text-slate-500 uppercase tracking-wider font-mono">Primary M1 Chart</div>
                  {responseTime !== null && <div className="text-xs font-mono text-green-400">⚡ {(responseTime / 1000).toFixed(2)}s</div>}
                </div>
                <div className="relative bg-black rounded-lg overflow-hidden">
                  <img src={image} alt="Uploaded primary chart" className="w-full h-auto max-h-[500px] object-contain" />
                  {analyzing && (
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center">
                      <div className="text-center">
                        <div className="relative w-20 h-20 mx-auto mb-3"><div className="absolute inset-0 border-4 border-green-400/30 rounded-full" /><div className="absolute inset-0 border-4 border-green-400 border-t-transparent rounded-full animate-spin" /><div className="absolute inset-0 flex items-center justify-center text-2xl">🎯</div></div>
                        <p className="font-bold text-lg">Analyzing evidence…</p>
                        <p className="text-xs text-slate-400 mt-1 font-mono">M1 validation • 4 confirmations • context check</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-3 space-y-3">
                  <ImagePreflightPanel result={preflight} loading={preflightLoading} />

                  {!analyzing && !signal && (
                    <>
                      <ContextImagesPanel images={contextImages} onUpload={handleContextUpload} onRemove={(label) => setContextImages((current) => ({ ...current, [label]: null }))} />

                      <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                        <div className="flex items-center justify-between mb-2"><label className="text-xs text-slate-400 font-semibold">🎚️ Min AI Setup Confidence</label><span className="text-sm font-bold text-green-400">{minConfidence}%</span></div>
                        <input type="range" min="50" max="90" value={minConfidence} onChange={(event: ChangeEvent<HTMLInputElement>) => setMinConfidence(Number(event.target.value))} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-green-500" />
                        <p className="text-[10px] text-slate-500 mt-1">A direction also needs ≥3/4 independent confirmations. Confidence alone cannot pass the Phase 3 gate.</p>
                      </div>

                      <button onClick={() => void analyzeChart()} disabled={!canAnalyze} className="w-full px-6 py-4 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 disabled:from-slate-700 disabled:to-slate-800 text-white font-black rounded-lg transition-all cursor-pointer disabled:cursor-not-allowed text-lg shadow-lg shadow-green-500/20">🧠 RUN PHASE 3 ANALYSIS</button>
                    </>
                  )}
                </div>
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

      {pasteToast && <div className="fixed bottom-6 right-6 bg-green-500 text-black px-4 py-2 rounded-lg shadow-lg font-bold text-sm z-50">✅ Image pasted + preflight started</div>}

      <footer className="border-t border-slate-900 py-4 mt-8"><div className="max-w-6xl mx-auto px-4 text-center text-[10px] text-slate-600">Phase 3 • Local image preflight • Independent evidence checks • Optional M5/H1 context • Educational analysis only</div></footer>
    </div>
  );
}

export default App;
