import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ApiKeyPanel } from './components/ApiKeyPanel';
import { AutoTestPanel, type AutoTestStats, type AutoTestStatus } from './components/AutoTestPanel';
import { BacktestPanel } from './components/BacktestPanel';
import { ContextImagesPanel } from './components/ContextImagesPanel';
import { Header } from './components/Header';
import { HistoryPanel } from './components/HistoryPanel';
import { ImagePreflightPanel } from './components/ImagePreflightPanel';
import { LiveStreamPreview } from './components/LiveStreamPreview';
import { LiveTabPanel } from './components/LiveTabPanel';
import { SignalCard } from './components/SignalCard';
import { UploadPanel } from './components/UploadPanel';
import {
  AUTO_AI_COOLDOWN_MS,
  AUTO_CAPTURE_INTERVAL_SECONDS,
  AUTO_MAX_CONSECUTIVE_ERRORS,
  AUTO_MIN_CHANGE_SCORE,
  buildAutoFrameFingerprint,
  compareAutoFrames,
  type AutoFrameFingerprint,
} from './services/autoTest';
import { analyzeChartWithGroq, humanizeGroqError, testGroqConnection, type ContextImage, type ContextLabel } from './services/groq';
import { analyzeImagePreflight, type ImagePreflightResult } from './services/imagePreflight';
import {
  applyPrecisionProfile,
  loadPrecisionProfile,
  savePrecisionProfile,
  type PrecisionProfile,
} from './services/precisionOptimizer';
import { clearApiKey, HISTORY_LIMIT, loadApiKey, loadHistory, loadSettings, saveApiKey, saveHistory, saveSettings } from './services/storage';
import {
  captureLiveTabFrame,
  getLiveTabInfo,
  humanizeTabCaptureError,
  isLiveTabCaptureSupported,
  isLiveTabStreamActive,
  requestLiveTabShare,
  stopLiveTabShare,
  type LiveTabInfo,
} from './services/tabCapture';
import { createHistoryItem, type SignalHistoryItem, type TradeSignal } from './signalLogic';
import { exportHistoryCsv, exportHistoryJson } from './utils/exportHistory';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
type PrimarySource = 'upload' | 'paste' | 'live';
type AnalysisStage = 'idle' | 'capturing' | 'preflight' | 'ai';

function App() {
  const liveStreamRef = useRef<MediaStream | null>(null);
  const autoTimerRef = useRef<number | null>(null);
  const autoRunningRef = useRef(false);
  const autoCycleBusyRef = useRef(false);
  const autoCycleRef = useRef<() => Promise<void>>(async () => undefined);
  const autoBaselineRef = useRef<AutoFrameFingerprint | null>(null);
  const autoLastAiAtRef = useRef(0);
  const autoConsecutiveErrorsRef = useRef(0);
  const autoLastBiasRef = useRef<string | null>(null);
  const autoStableStreakRef = useRef(0);
  const [apiKey, setApiKey] = useState(() => loadApiKey());
  const [image, setImage] = useState<string | null>(null);
  const [primarySource, setPrimarySource] = useState<PrimarySource>('upload');
  const [liveTabInfo, setLiveTabInfo] = useState<LiveTabInfo | null>(null);
  const [liveTabBusy, setLiveTabBusy] = useState(false);
  const [contextImages, setContextImages] = useState<Record<ContextLabel, string | null>>({ M5: null, H1: null });
  const [preflight, setPreflight] = useState<ImagePreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStage, setAnalysisStage] = useState<AnalysisStage>('idle');
  const [signal, setSignal] = useState<TradeSignal | null>(null);
  const [error, setError] = useState('');
  const [responseTime, setResponseTime] = useState<number | null>(null);
  const [history, setHistory] = useState<SignalHistoryItem[]>(() => loadHistory());
  const [pasteToast, setPasteToast] = useState(false);
  const [minConfidence, setMinConfidence] = useState(() => loadSettings().minConfidence);
  const [autoIntervalSeconds, setAutoIntervalSeconds] = useState(() => loadSettings().autoIntervalSeconds || AUTO_CAPTURE_INTERVAL_SECONDS);
  const [autoTestEnabled, setAutoTestEnabled] = useState(false);
  const [backtestOpen, setBacktestOpen] = useState(false);
  const [precisionProfile, setPrecisionProfile] = useState<PrecisionProfile | null>(() => loadPrecisionProfile());
  const [autoStats, setAutoStats] = useState<AutoTestStats>({
    status: 'idle',
    checks: 0,
    aiRuns: 0,
    skippedSimilar: 0,
    skippedCooldown: 0,
    qualityBlocks: 0,
    errors: 0,
    lastChangeScore: null,
    lastBias: null,
    stableStreak: 0,
    lastRunAt: null,
  });
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');

  const liveTabSupported = isLiveTabCaptureSupported();
  const liveTabActive = Boolean(liveTabInfo && isLiveTabStreamActive(liveStreamRef.current));

  useEffect(() => saveSettings({ minConfidence, autoIntervalSeconds }), [minConfidence, autoIntervalSeconds]);
  useEffect(() => saveHistory(history), [history]);

  useEffect(() => () => {
    autoRunningRef.current = false;
    if (autoTimerRef.current !== null) window.clearTimeout(autoTimerRef.current);
    stopLiveTabShare(liveStreamRef.current);
    liveStreamRef.current = null;
  }, []);

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

  const clearAutoTimer = () => {
    if (autoTimerRef.current !== null) {
      window.clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  };

  const stopAutoTest = (status: AutoTestStatus = 'idle') => {
    autoRunningRef.current = false;
    autoCycleBusyRef.current = false;
    clearAutoTimer();
    setAutoTestEnabled(false);
    setAutoStats((current) => ({ ...current, status }));
  };

  const scheduleAutoCycle = (delayMs = autoIntervalSeconds * 1000) => {
    clearAutoTimer();
    if (!autoRunningRef.current) return;
    autoTimerRef.current = window.setTimeout(() => {
      void autoCycleRef.current();
    }, delayMs);
  };

  const stopCurrentLiveTab = () => {
    stopAutoTest();
    stopLiveTabShare(liveStreamRef.current);
    liveStreamRef.current = null;
    setLiveTabInfo(null);
    setLiveTabBusy(false);
  };

  const inspectPrimaryFrame = async (dataUrl: string, source: PrimarySource): Promise<ImagePreflightResult> => {
    setImage(dataUrl);
    setPrimarySource(source);
    setSignal(null);
    setResponseTime(null);
    setPreflightLoading(true);
    setPreflight(null);

    try {
      const result = await analyzeImagePreflight(dataUrl);
      setPreflight(result);
      return result;
    } finally {
      setPreflightLoading(false);
    }
  };

  const loadPrimaryImage = async (file: File, pasted = false) => {
    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    stopCurrentLiveTab();
    setError('');

    try {
      const dataUrl = await readImageFile(file);
      await inspectPrimaryFrame(dataUrl, pasted ? 'paste' : 'upload');
      if (pasted) {
        setPasteToast(true);
        window.setTimeout(() => setPasteToast(false), 1800);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not inspect this image.');
    }
  };

  const captureFreshLiveFrame = async (): Promise<{ image: string; preflight: ImagePreflightResult }> => {
    const stream = liveStreamRef.current;
    if (!isLiveTabStreamActive(stream)) {
      throw new Error('Live tab sharing has stopped. Add the chart tab again before analysis.');
    }

    setLiveTabBusy(true);
    try {
      const dataUrl = await captureLiveTabFrame(stream as MediaStream);
      const result = await inspectPrimaryFrame(dataUrl, 'live');
      return { image: dataUrl, preflight: result };
    } finally {
      setLiveTabBusy(false);
    }
  };

  const handleStartLiveTab = async () => {
    if (autoRunningRef.current) stopAutoTest();
    setLiveTabBusy(true);
    setError('');
    let newStream: MediaStream | null = null;

    try {
      newStream = await requestLiveTabShare();
      const oldStream = liveStreamRef.current;
      liveStreamRef.current = newStream;
      if (oldStream && oldStream !== newStream) stopLiveTabShare(oldStream);

      const info = getLiveTabInfo(newStream);
      setLiveTabInfo(info);
      setSignal(null);
      setResponseTime(null);

      const track = newStream.getVideoTracks()[0];
      track?.addEventListener('ended', () => {
        if (liveStreamRef.current === newStream) {
          stopAutoTest();
          liveStreamRef.current = null;
          setLiveTabInfo(null);
          setLiveTabBusy(false);
        }
      }, { once: true });

      const dataUrl = await captureLiveTabFrame(newStream);
      await inspectPrimaryFrame(dataUrl, 'live');
    } catch (err) {
      if (newStream && liveStreamRef.current === newStream) stopCurrentLiveTab();
      setError(humanizeTabCaptureError(err));
    } finally {
      setLiveTabBusy(false);
    }
  };

  const handleStopLiveTab = () => {
    stopCurrentLiveTab();
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
    if (autoRunningRef.current) stopAutoTest();
    setApiKey(value);
    saveApiKey(value);
    setTestState('idle');
  };

  const handleApiKeyClear = () => {
    if (autoRunningRef.current) stopAutoTest();
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

  const executeAiAnalysis = async (analysisImage: string, analysisPreflight: ImagePreflightResult): Promise<TradeSignal> => {
    const extraImages: ContextImage[] = (['M5', 'H1'] as ContextLabel[])
      .filter((label) => Boolean(contextImages[label]))
      .map((label) => ({ label, image: contextImages[label] as string }));

    const result = await analyzeChartWithGroq({
      apiKey,
      image: analysisImage,
      minConfidence,
      preflight: analysisPreflight,
      contextImages: extraImages,
    });
    const gatedSignal = applyPrecisionProfile(result.signal, precisionProfile);
    setSignal(gatedSignal);
    setResponseTime(result.responseTimeMs);
    const historyItem = createHistoryItem(gatedSignal, result.responseTimeMs, minConfidence);
    setHistory((current) => [historyItem, ...current].slice(0, HISTORY_LIMIT));
    return gatedSignal;
  };

  const handleToggleAutoTest = () => {
    if (autoRunningRef.current) {
      stopAutoTest();
      return;
    }
    if (!apiKey.trim()) {
      setError('Add your Groq API key before starting Auto Test.');
      return;
    }
    if (!liveTabActive) {
      setError('Add a live browser tab before starting Auto Test.');
      return;
    }

    autoRunningRef.current = true;
    autoCycleBusyRef.current = false;
    autoBaselineRef.current = null;
    autoLastAiAtRef.current = 0;
    autoConsecutiveErrorsRef.current = 0;
    autoLastBiasRef.current = null;
    autoStableStreakRef.current = 0;
    setAutoTestEnabled(true);
    setAutoStats({
      status: 'watching',
      checks: 0,
      aiRuns: 0,
      skippedSimilar: 0,
      skippedCooldown: 0,
      qualityBlocks: 0,
      errors: 0,
      lastChangeScore: null,
      lastBias: null,
      stableStreak: 0,
      lastRunAt: null,
    });
    setError('');
    scheduleAutoCycle(0);
  };

  autoCycleRef.current = async () => {
    if (!autoRunningRef.current) return;
    if (autoCycleBusyRef.current || analyzing || liveTabBusy) {
      scheduleAutoCycle(1000);
      return;
    }

    const stream = liveStreamRef.current;
    if (!isLiveTabStreamActive(stream)) {
      setError('Auto Test stopped because live tab sharing ended. Add the chart tab again to restart it.');
      stopAutoTest('error');
      return;
    }
    if (!apiKey.trim()) {
      setError('Auto Test stopped because the Groq API key is missing.');
      stopAutoTest('error');
      return;
    }

    autoCycleBusyRef.current = true;
    setAutoStats((current) => ({ ...current, status: 'capturing' }));

    try {
      const frame = await captureLiveTabFrame(stream as MediaStream);
      const fingerprint = await buildAutoFrameFingerprint(frame);
      const baseline = autoBaselineRef.current;
      const change = baseline
        ? compareAutoFrames(baseline, fingerprint)
        : { score: 100, meanDifference: 100, changedPixels: 100, edgeDifference: 100 };

      setAutoStats((current) => ({
        ...current,
        checks: current.checks + 1,
        lastChangeScore: change.score,
      }));

      if (baseline && change.score < AUTO_MIN_CHANGE_SCORE) {
        setAutoStats((current) => ({
          ...current,
          status: 'watching',
          skippedSimilar: current.skippedSimilar + 1,
        }));
        return;
      }

      const elapsedSinceAi = Date.now() - autoLastAiAtRef.current;
      if (autoLastAiAtRef.current > 0 && elapsedSinceAi < AUTO_AI_COOLDOWN_MS) {
        setAutoStats((current) => ({
          ...current,
          status: 'cooldown',
          skippedCooldown: current.skippedCooldown + 1,
        }));
        return;
      }

      setAnalyzing(true);
      setAnalysisStage('preflight');
      setPreflightLoading(true);
      setAutoStats((current) => ({ ...current, status: 'preflight' }));
      const quality = await inspectPrimaryFrame(frame, 'live');

      if (quality.status === 'block') {
        autoBaselineRef.current = fingerprint;
        setAutoStats((current) => ({
          ...current,
          status: 'quality-block',
          qualityBlocks: current.qualityBlocks + 1,
        }));
        return;
      }

      setAnalysisStage('ai');
      setAutoStats((current) => ({ ...current, status: 'analyzing' }));
      autoLastAiAtRef.current = Date.now();
      const resultSignal = await executeAiAnalysis(frame, quality);
      setError('');
      autoBaselineRef.current = fingerprint;
      autoConsecutiveErrorsRef.current = 0;

      if (resultSignal.bias !== 'NEUTRAL' && resultSignal.bias === autoLastBiasRef.current) {
        autoStableStreakRef.current += 1;
      } else if (resultSignal.bias !== 'NEUTRAL') {
        autoStableStreakRef.current = 1;
      } else {
        autoStableStreakRef.current = 0;
      }
      autoLastBiasRef.current = resultSignal.bias;

      setAutoStats((current) => ({
        ...current,
        status: 'watching',
        aiRuns: current.aiRuns + 1,
        lastBias: resultSignal.bias,
        stableStreak: autoStableStreakRef.current,
        lastRunAt: Date.now(),
      }));
    } catch (err) {
      autoConsecutiveErrorsRef.current += 1;
      setAutoStats((current) => ({
        ...current,
        status: 'error',
        errors: current.errors + 1,
      }));
      setError(err instanceof DOMException ? humanizeTabCaptureError(err) : humanizeGroqError(err));

      if (autoConsecutiveErrorsRef.current >= AUTO_MAX_CONSECUTIVE_ERRORS) {
        setError('Auto Test paused after 3 consecutive failures. Check the shared tab, connection, and Groq API status, then start it again.');
        stopAutoTest('error');
      }
    } finally {
      setPreflightLoading(false);
      setAnalyzing(false);
      setAnalysisStage('idle');
      autoCycleBusyRef.current = false;
      if (autoRunningRef.current) scheduleAutoCycle();
    }
  };

  const analyzeChart = async () => {
    if (autoRunningRef.current) {
      setError('Auto Test is running. Stop Auto Test before starting a manual analysis.');
      return;
    }
    if (!apiKey.trim()) {
      setError('Add your Groq API key first.');
      return;
    }
    if (!image && !liveTabActive) {
      setError('Add a live browser tab or upload an M1 chart screenshot first.');
      return;
    }

    setAnalyzing(true);
    setSignal(null);
    setResponseTime(null);
    setError('');

    try {
      let analysisImage = image;
      let analysisPreflight = preflight;

      if (liveTabActive) {
        setAnalysisStage('capturing');
        setPreflightLoading(true);
        const freshFrame = await captureFreshLiveFrame();
        analysisImage = freshFrame.image;
        analysisPreflight = freshFrame.preflight;
      }

      setAnalysisStage('preflight');
      if (!analysisImage) throw new Error('No chart frame is available for analysis.');
      if (!analysisPreflight) throw new Error('Wait for the local screenshot preflight to finish.');
      if (analysisPreflight.status === 'block') {
        throw new Error(liveTabActive
          ? 'The freshly captured live-tab frame failed local preflight. Make the chart clearer or enlarge it, then click Analyze again.'
          : 'This screenshot failed local preflight. Upload a clearer M1 screenshot before analysis.');
      }

      setAnalysisStage('ai');
      await executeAiAnalysis(analysisImage, analysisPreflight);
    } catch (err) {
      setError(humanizeGroqError(err));
    } finally {
      setPreflightLoading(false);
      setAnalyzing(false);
      setAnalysisStage('idle');
    }
  };

  const reset = () => {
    stopCurrentLiveTab();
    setImage(null);
    setPrimarySource('upload');
    setContextImages({ M5: null, H1: null });
    setPreflight(null);
    setPreflightLoading(false);
    setSignal(null);
    setError('');
    setResponseTime(null);
    setAnalysisStage('idle');
  };

  const deleteHistoryItem = (id: string) => setHistory((current) => current.filter((item) => item.id !== id));
  const clearHistory = () => {
    if (window.confirm('Clear all locally saved signal history?')) setHistory([]);
  };

  const canAnalyze = Boolean(
    apiKey.trim()
    && !preflightLoading
    && !autoTestEnabled
    && (liveTabActive || (preflight && preflight.status !== 'block')),
  );

  const sourceLabel = liveTabActive
    ? 'LIVE TAB • REAL-TIME PREVIEW'
    : primarySource === 'live'
      ? 'LAST LIVE TAB CAPTURE'
      : primarySource === 'paste'
        ? 'PASTED SCREENSHOT'
        : 'UPLOADED SCREENSHOT';

  const stageText = analysisStage === 'capturing'
    ? ['Capturing live tab…', 'Taking a fresh frame from the shared chart tab']
    : analysisStage === 'preflight'
      ? ['Checking fresh frame…', 'Local quality preflight before the API request']
      : ['Analyzing evidence…', 'M1 validation • 4 confirmations • context check'];

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white">
      <Header hasImage={Boolean(image)} onNew={reset} liveTabActive={liveTabActive} />

      <main className="max-w-6xl mx-auto px-4 py-6">
        <ApiKeyPanel apiKey={apiKey} onChange={handleApiKeyChange} onClear={handleApiKeyClear} onTest={handleTestConnection} testState={testState} />

        {!image ? (
          <UploadPanel onUpload={handleImageUpload} onStartLiveTab={() => void handleStartLiveTab()} liveTabSupported={liveTabSupported} liveTabBusy={liveTabBusy} />
        ) : (
          <div className="space-y-2">
            {signal && (
              <SignalCard signal={signal} onRetry={() => void analyzeChart()} analyzing={analyzing} minConfidence={minConfidence} />
            )}

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-3 items-start">
              <section className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/40 p-2">
                <div className="mb-1.5 flex items-center justify-between gap-3 px-1">
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">M1 Live Chart</div>
                    <div className={`truncate text-[9px] font-bold ${liveTabActive ? 'text-green-400' : 'text-slate-600'}`}>{sourceLabel}</div>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    {liveTabActive && <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 font-bold text-green-400">● LIVE</span>}
                    {responseTime !== null && <span className="font-mono text-cyan-400">⚡ {(responseTime / 1000).toFixed(2)}s</span>}
                  </div>
                </div>

                <div className="relative overflow-hidden rounded-lg bg-black">
                  {liveTabActive && liveStreamRef.current ? (
                    <LiveStreamPreview
                      stream={liveStreamRef.current}
                      className="h-[56vh] min-h-[340px] max-h-[620px] w-full object-contain"
                    />
                  ) : (
                    <img src={image} alt="Primary chart frame" className="h-[56vh] min-h-[340px] max-h-[620px] w-full object-contain" />
                  )}

                  {analyzing && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/75 backdrop-blur-[2px]">
                      <div className="rounded-xl border border-slate-700 bg-slate-950/90 px-6 py-4 text-center shadow-2xl">
                        <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-2 border-green-400 border-t-transparent" />
                        <p className="text-sm font-black">{stageText[0]}</p>
                        <p className="mt-1 text-[10px] text-slate-500">{stageText[1]}</p>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              <aside className="space-y-2 xl:sticky xl:top-[58px]">
                <LiveTabPanel
                  info={liveTabInfo}
                  active={liveTabActive}
                  busy={liveTabBusy || analyzing}
                  onChangeTab={() => void handleStartLiveTab()}
                  onStop={handleStopLiveTab}
                />

                {liveTabActive && (
                  <AutoTestPanel
                    enabled={autoTestEnabled}
                    canStart={Boolean(apiKey.trim() && liveTabActive)}
                    busy={liveTabBusy || analyzing}
                    intervalSeconds={autoIntervalSeconds}
                    stats={autoStats}
                    onToggle={handleToggleAutoTest}
                    onIntervalChange={setAutoIntervalSeconds}
                  />
                )}

                <ImagePreflightPanel result={preflight} loading={preflightLoading} />

                <div className="rounded-lg border border-slate-800 bg-slate-900/55 p-2.5">
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Min confidence</label>
                    <span className="text-xs font-black text-green-400">{minConfidence}%</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="90"
                    value={minConfidence}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setMinConfidence(Number(event.target.value))}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-700 accent-green-500"
                  />
                </div>

                {precisionProfile && (
                  <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[9px] font-black uppercase tracking-wider text-purple-300">🎯 Precision profile active</div>
                        <div className="mt-0.5 text-[9px] text-slate-500">
                          {precisionProfile.sourcePair} · holdout {precisionProfile.holdout.winRate ?? '—'}% · conf ≥ {precisionProfile.rule.minConfidence}% · {precisionProfile.rule.minConfirmations}/4+
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          savePrecisionProfile(null);
                          setPrecisionProfile(null);
                        }}
                        className="rounded bg-slate-800 px-2 py-1 text-[8px] font-bold text-slate-400 hover:bg-slate-700"
                      >
                        Disable
                      </button>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => void analyzeChart()}
                  disabled={!canAnalyze}
                  className="w-full rounded-lg bg-green-500 px-4 py-2.5 text-sm font-black text-slate-950 transition hover:bg-green-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                >
                  {liveTabActive ? '📸 ANALYZE NOW' : '🧠 ANALYZE CHART'}
                </button>

                <button
                  onClick={() => {
                    if (autoRunningRef.current) stopAutoTest();
                    setBacktestOpen(true);
                  }}
                  disabled={analyzing}
                  className="w-full rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-[11px] font-black text-cyan-300 transition hover:bg-cyan-500/20 disabled:opacity-40"
                >
                  🧪 BACKTEST LAB
                </button>

                <details className="group rounded-lg border border-slate-800 bg-slate-900/45">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <span>Context · M5 / H1</span>
                    <span className="text-slate-600 group-open:rotate-90">›</span>
                  </summary>
                  <div className="border-t border-slate-800 p-2">
                    <ContextImagesPanel
                      images={contextImages}
                      onUpload={handleContextUpload}
                      onRemove={(label) => setContextImages((current) => ({ ...current, [label]: null }))}
                    />
                  </div>
                </details>

                <details className="group rounded-lg border border-slate-800 bg-slate-900/45">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <span>History · {history.length}</span>
                    <span className="text-slate-600 group-open:rotate-90">›</span>
                  </summary>
                  <div className="max-h-[45vh] overflow-y-auto border-t border-slate-800 p-2">
                    <HistoryPanel
                      history={history}
                      onDelete={deleteHistoryItem}
                      onClear={clearHistory}
                      onExportJson={() => exportHistoryJson(history)}
                      onExportCsv={() => exportHistoryCsv(history)}
                    />
                  </div>
                </details>
              </aside>
            </div>
          </div>
        )}

        {error && <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-4"><p className="text-red-400 font-bold text-sm mb-1">❌ Error</p><p className="text-red-300 text-xs">{error}</p></div>}
      </main>

      {backtestOpen && (
        <BacktestPanel
          apiKey={apiKey}
          minConfidence={minConfidence}
          activePrecisionProfile={precisionProfile}
          onApplyPrecisionProfile={(profile) => {
            savePrecisionProfile(profile);
            setPrecisionProfile(profile);
          }}
          onClose={() => setBacktestOpen(false)}
        />
      )}

      {pasteToast && <div className="fixed bottom-6 right-6 bg-green-500 text-black px-4 py-2 rounded-lg shadow-lg font-bold text-sm z-50">✅ Image pasted + preflight started</div>}

      <footer className="border-t border-slate-900 py-4 mt-8"><div className="max-w-6xl mx-auto px-4 text-center text-[10px] text-slate-600">Phase 4A.1 • Train/holdout precision optimizer • Validated profiles only • Educational analysis</div></footer>
    </div>
  );
}

export default App;
