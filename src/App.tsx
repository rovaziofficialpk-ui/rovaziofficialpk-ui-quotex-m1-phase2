import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { SecurityPanel } from './components/SecurityPanel';
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
import { OutcomeResolverPanel } from './components/OutcomeResolverPanel';
import {
  AUTO_AI_COOLDOWN_MS,
  AUTO_CAPTURE_INTERVAL_SECONDS,
  AUTO_MAX_CONSECUTIVE_ERRORS,
  AUTO_MIN_CHANGE_SCORE,
  buildAutoFrameFingerprint,
  compareAutoFrames,
  type AutoFrameFingerprint,
} from './services/autoTest';
import {
  GROQ_MODEL,
  GROQ_PROMPT_VERSION,
  GROQ_SEED,
  GROQ_TEMPERATURE,
  analyzeChartWithGroq,
  humanizeGroqError,
  testGroqConnection,
  type ContextImage,
  type ContextLabel,
} from './services/groq';
import { buildAuditArtifact, buildFullFrameArtifact, buildPrivacyMaskedSourceArtifact, sha256DataUrl } from './services/auditArtifacts';
import { clearAuditToken, getServerHealth, loadAuditToken, saveAuditToken, verifyAuditAuth, logSettingChange, type ServerHealth } from './services/apiClient';
import { verifyStage3CFrame, type Stage3CVerification } from './services/screenStage3C';
import { buildResolverSnapshot, type ResolverSnapshot } from './services/outcomeResolver';
import {
  INPUT_PIPELINE_CONFIG_VERSION,
  LAYOUT_PROFILE_VERSION,
  createDeterministicNeutralSignal,
  inspectAndCropSingleFrame,
  type CropResult,
} from './services/screenPipeline';
import { newRecordId, persistReproDecision, type ReproDecisionRecord } from './services/reproAudit';
import { analyzeImagePreflight, type ImagePreflightResult } from './services/imagePreflight';
import { applyAuditEdgeGate } from './services/edgeGate';
import { appendAuditSignal, createAuditSignalRecord, type AuditSignalSource } from './services/auditSignalLog';
import {
  applyPrecisionProfile,
  loadPrecisionProfile,
  savePrecisionProfile,
  type PrecisionProfile,
} from './services/precisionOptimizer';
import { clearApiKey, HISTORY_LIMIT, loadHistory, loadSettings, saveHistory, saveSettings } from './services/storage';
import {
  captureLiveTabFrame,
  captureLiveTabFrameDetailed,
  getLiveTabInfo,
  humanizeTabCaptureError,
  isLiveTabCaptureSupported,
  isLiveTabStreamActive,
  requestLiveTabShare,
  stopLiveTabShare,
  type CaptureEnvironment,
  type LiveTabInfo,
} from './services/tabCapture';
import { createHistoryItem, type SignalHistoryItem, type TradeSignal } from './signalLogic';
import { exportHistoryCsv, exportHistoryJson } from './utils/exportHistory';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
type PrimarySource = 'upload' | 'paste' | 'live';
type AnalysisStage = 'idle' | 'capturing' | 'preflight' | 'ai';

interface ScreenDiagnosticsState {
  capturedAt: string | null;
  sourceFrameSize: { width: number; height: number } | null;
  captureEnvironment: CaptureEnvironment | null;
  layoutFound: boolean;
  verification: Stage3CVerification | null;
  crops: CropResult[];
}

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
  const lastPlatformClockRef = useRef<{ secondsOfDay: number; observedClientMs: number } | null>(null);
  const [auditToken, setAuditTokenState] = useState(() => loadAuditToken());
  const [authVerified, setAuthVerified] = useState(false);
  const [serverHealth, setServerHealth] = useState<ServerHealth | null>(null);
  const [securityBusy, setSecurityBusy] = useState(false);
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
  const [configuredAsset, setConfiguredAsset] = useState(() => loadSettings().configuredAsset || '');
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
  const [screenDiagnostics, setScreenDiagnostics] = useState<ScreenDiagnosticsState | null>(null);
  const apiKey = authVerified ? 'server' : '';

  const liveTabSupported = isLiveTabCaptureSupported();
  const liveTabActive = Boolean(liveTabInfo && isLiveTabStreamActive(liveStreamRef.current));

  useEffect(() => saveSettings({
    minConfidence,
    autoIntervalSeconds,
    configuredAsset: configuredAsset.trim() || null,
  }), [minConfidence, autoIntervalSeconds, configuredAsset]);
  useEffect(() => saveHistory(history), [history]);

  useEffect(() => {
    clearApiKey();
    let cancelled = false;
    void getServerHealth()
      .then(async (health) => {
        if (cancelled) return;
        setServerHealth(health);
        if (auditToken) {
          try {
            const auth = await verifyAuditAuth();
            if (!cancelled) {
              setAuthVerified(auth.authenticated);
              setServerHealth((current) => current ? { ...current, groqConfigured: auth.groqConfigured } : health);
            }
          } catch {
            if (!cancelled) setAuthVerified(false);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setServerHealth(null);
      });
    return () => { cancelled = true; };
  }, []);

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

  const captureFreshLiveFrame = async (): Promise<{
    image: string;
    preflight: ImagePreflightResult;
    capturedAt: string;
    captureMs: number;
    preflightMs: number;
    sourceFrameSize: { width: number; height: number };
    captureEnvironment: CaptureEnvironment;
  }> => {
    const stream = liveStreamRef.current;
    if (!isLiveTabStreamActive(stream)) {
      throw new Error('Live tab sharing has stopped. Add the chart tab again before analysis.');
    }

    setLiveTabBusy(true);
    try {
      const captured = await captureLiveTabFrameDetailed(stream as MediaStream);
      const preflightStartedAt = performance.now();
      const result = await inspectPrimaryFrame(captured.dataUrl, 'live');
      const preflightMs = Math.round(performance.now() - preflightStartedAt);
      return {
        image: captured.dataUrl,
        preflight: result,
        capturedAt: captured.capturedAt,
        captureMs: captured.captureMs,
        preflightMs,
        sourceFrameSize: { width: captured.sourceWidth, height: captured.sourceHeight },
        captureEnvironment: captured.environment,
      };
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

  const handleAuthenticate = async (token: string) => {
    if (autoRunningRef.current) stopAutoTest();
    setSecurityBusy(true);
    setError('');
    try {
      saveAuditToken(token);
      setAuditTokenState(token);
      const auth = await verifyAuditAuth();
      setAuthVerified(auth.authenticated);
      setServerHealth((current) => current
        ? { ...current, groqConfigured: auth.groqConfigured }
        : {
          ok: true,
          durableAudit: true,
          authConfigured: true,
          groqConfigured: auth.groqConfigured,
          ocrConfigured: true,
          auditLock: true,
        });
    } catch (err) {
      clearAuditToken();
      setAuditTokenState('');
      setAuthVerified(false);
      setError(err instanceof Error ? err.message : 'Audit authentication failed.');
    } finally {
      setSecurityBusy(false);
    }
  };

  const handleLogout = () => {
    if (autoRunningRef.current) stopAutoTest();
    clearAuditToken();
    setAuditTokenState('');
    setAuthVerified(false);
  };

  const handleMinConfidenceChange = (value: number) => {
    void logSettingChange('minConfidence', minConfidence, value, INPUT_PIPELINE_CONFIG_VERSION);
    setMinConfidence(value);
  };

  const handleAutoIntervalChange = (value: number) => {
    void logSettingChange('autoIntervalSeconds', autoIntervalSeconds, value, INPUT_PIPELINE_CONFIG_VERSION);
    setAutoIntervalSeconds(value);
  };

  const handleConfiguredAssetChange = (value: string) => {
    const normalized = value.toUpperCase();
    void logSettingChange('configuredAsset', configuredAsset || null, normalized || null, INPUT_PIPELINE_CONFIG_VERSION);
    setConfiguredAsset(normalized);
  };

  const handleTestConnection = async () => {
    if (!authVerified) return;
    setTestState('testing');
    setError('');
    try {
      await testGroqConnection('server');
      setTestState('ok');
    } catch (err) {
      setTestState('error');
      setError(humanizeGroqError(err));
    }
  };

  const captureOutcomeResolverSnapshot = async (): Promise<ResolverSnapshot> => {
    const stream = liveStreamRef.current;
    if (!authVerified) throw new Error('Authenticate the secure audit session first.');
    if (!configuredAsset.trim()) throw new Error('Configure the exact asset before recording a demo outcome.');
    if (!isLiveTabStreamActive(stream)) throw new Error('Share the live Quotex tab before using the outcome resolver.');

    const captured = await captureLiveTabFrameDetailed(stream as MediaStream);
    const sourceHash = await sha256DataUrl(captured.dataUrl);
    const deterministic = await inspectAndCropSingleFrame(captured.dataUrl, configuredAsset.trim());

    const verification = await verifyStage3CFrame({
      crops: deterministic.crops,
      metrics: deterministic.metrics,
      configuredAsset: configuredAsset.trim(),
      previousClock: lastPlatformClockRef.current,
    });

    if (verification.platformClock.utcSecondsOfDay !== null) {
      lastPlatformClockRef.current = {
        secondsOfDay: verification.platformClock.utcSecondsOfDay,
        observedClientMs: Date.now(),
      };
    }

    return buildResolverSnapshot({
      crops: deterministic.crops,
      verification,
      capturedAt: captured.capturedAt,
      sourceFrameSha256: sourceHash.sha256,
    });
  };

  const executeAiAnalysis = async (
    analysisImage: string,
    analysisPreflight: ImagePreflightResult,
    auditMeta: {
      capturedAt: string | null;
      captureMs: number | null;
      preflightMs: number | null;
      sourceFrameSize: { width: number; height: number } | null;
      captureEnvironment: CaptureEnvironment | null;
    } = { capturedAt: null, captureMs: null, preflightMs: null, sourceFrameSize: null, captureEnvironment: null },
  ): Promise<TradeSignal> => {
    const source: AuditSignalSource = primarySource === 'live'
      ? 'live_tab'
      : primarySource === 'paste'
        ? 'paste'
        : 'upload';

    const deterministicStartedAt = performance.now();
    let deterministic = await inspectAndCropSingleFrame(analysisImage, configuredAsset.trim() || null);
    const structuralMs = Math.round(performance.now() - deterministicStartedAt);

    const sourceArtifact = await buildPrivacyMaskedSourceArtifact(analysisImage, auditMeta.capturedAt);
    const cropArtifacts = await Promise.all(deterministic.crops.map((crop) => (
      buildAuditArtifact({
        role: crop.role,
        dataUrl: crop.dataUrl,
        capturedAt: auditMeta.capturedAt,
        cropRect: crop.rect,
        sourceFrameSize: sourceArtifact.sourceFrameSize,
        sourceFrameSha256: sourceArtifact.sourceFrameSha256,
      })
    )));
    const artifacts = [sourceArtifact, ...cropArtifacts];

    const capturedMs = auditMeta.capturedAt ? Date.parse(auditMeta.capturedAt) : Number.NaN;

    let fieldVerification: Awaited<ReturnType<typeof verifyStage3CFrame>> | null = null;
    let deterministicScreenMs = structuralMs;
    if (deterministic.safeForAi) {
      const fieldStartedAt = performance.now();
      fieldVerification = await verifyStage3CFrame({
        crops: deterministic.crops,
        metrics: deterministic.metrics,
        configuredAsset: configuredAsset.trim() || null,
        previousClock: lastPlatformClockRef.current,
      });
      if (fieldVerification.platformClock.utcSecondsOfDay !== null) {
        lastPlatformClockRef.current = {
          secondsOfDay: fieldVerification.platformClock.utcSecondsOfDay,
          observedClientMs: Date.now(),
        };
      }
      deterministicScreenMs += Math.round(performance.now() - fieldStartedAt);

      const fieldReasons = [...fieldVerification.reasons];
      if (fieldVerification.frameVerified && !fieldVerification.productionEligible) {
        fieldReasons.push('LAYOUT_VALIDATION_INCOMPLETE');
      }
      deterministic = {
        ...deterministic,
        safeForAi: fieldVerification.productionEligible,
        reasonCode: (fieldReasons[0] || null),
        reasons: Array.from(new Set([...deterministic.reasons, ...fieldReasons])),
        timeframe: fieldVerification.timeframe,
        asset: fieldVerification.asset,
        priceAxis: {
          readable: fieldVerification.priceAxis.readable,
          min: fieldVerification.priceAxis.min,
          max: fieldVerification.priceAxis.max,
          reasonCode: fieldVerification.priceAxis.reasonCode,
        },
        timeAxis: {
          readable: fieldVerification.timeAxis.readable,
          spanSeconds: fieldVerification.timeAxis.spanSeconds,
          reasonCode: fieldVerification.timeAxis.reasonCode,
        },
      };
    }
    setScreenDiagnostics({
      capturedAt: auditMeta.capturedAt,
      sourceFrameSize: auditMeta.sourceFrameSize ?? { width: deterministic.metrics.width, height: deterministic.metrics.height },
      captureEnvironment: auditMeta.captureEnvironment,
      layoutFound: deterministic.layoutFound,
      verification: fieldVerification,
      crops: deterministic.crops,
    });

    const persistRecord = async (record: ReproDecisionRecord) => {
      const durable = await persistReproDecision(record, artifacts);
      if (!durable.durable) {
        setError('Audit warning: decision remained NEUTRAL, but durable server audit storage failed. A local append-only copy was retained.');
      }
    };

    if (!deterministic.safeForAi) {
      const timeframeRejected = deterministic.reasons.includes('TIMEFRAME_UNVERIFIED')
        || deterministic.reasons.includes('TIMEFRAME_MISMATCH');
      if (timeframeRejected && analysisImage.startsWith('data:image/png')) {
        artifacts.push(await buildFullFrameArtifact('native_source_frame_png', analysisImage, auditMeta.capturedAt));
      }

      const decisionAt = new Date().toISOString();
      const neutral = createDeterministicNeutralSignal(deterministic);
      if (fieldVerification?.asset.normalized) neutral.pair = fieldVerification.asset.normalized;
      if (fieldVerification?.timeframe.parsedValue === 'M1') neutral.timeframe = 'M1';
      setSignal(neutral);
      setResponseTime(null);
      setHistory((current) => [createHistoryItem(neutral, 0, minConfidence), ...current].slice(0, HISTORY_LIMIT));

      void appendAuditSignal(createAuditSignalRecord({
        signal: neutral,
        source,
        capturedAt: auditMeta.capturedAt,
        decisionAt,
        entryPrice: null,
        entryTimestamp: null,
        expiryTimestamp: null,
        expirySeconds: null,
        payout: fieldVerification?.payout.payoutDecimal ?? null,
        payoutBreakevenWinRate: fieldVerification?.payout.breakevenWinRate ?? null,
        payoutReadReason: fieldVerification?.payout.reasonCode ?? null,
        platformClockUtc: fieldVerification?.platformClock.parsedText ?? null,
        secondsIntoCandle: fieldVerification?.platformClock.secondsIntoCandle ?? null,
        chartType: fieldVerification?.chartType.detected ?? null,
        priceAxisMin: fieldVerification?.priceAxis.min ?? null,
        priceAxisMax: fieldVerification?.priceAxis.max ?? null,
        priceAxisR2: fieldVerification?.priceAxis.r2 ?? null,
        timeframeDisagreement: fieldVerification?.timeframeDisagreement ?? null,
        fieldLegibility: fieldVerification?.legibility ?? null,
        outcome: 'NEUTRAL',
        feed: primarySource === 'live' ? 'Quotex shared-tab visual feed' : 'Uploaded chart image; feed unknown',
        rawDataRef: sourceArtifact.sourceFrameSha256,
      })).catch(() => undefined);

      const decisionMs = Date.parse(decisionAt);
      const totalCaptureToDecision = Number.isFinite(capturedMs) && Number.isFinite(decisionMs)
        ? Math.max(0, decisionMs - capturedMs)
        : null;

      const reproRecord: ReproDecisionRecord = {
        schemaVersion: 'decision-record-v1',
        recordId: newRecordId(),
        configVersion: INPUT_PIPELINE_CONFIG_VERSION,
        promptVersion: GROQ_PROMPT_VERSION,
        modelName: GROQ_MODEL,
        temperature: GROQ_TEMPERATURE,
        seed: GROQ_SEED,
        seedReason: 'Fixed before outcome analysis. No model call occurred because deterministic verification failed.',
        systemFingerprint: null,
        capturedAt: auditMeta.capturedAt,
        decisionAt,
        source,
        configuredTimeframe: 'M1',
        layoutProfileVersion: LAYOUT_PROFILE_VERSION,
        layoutReason: !deterministic.layoutFound
          ? 'LAYOUT_NOT_FOUND'
          : fieldVerification?.frameVerified && !fieldVerification.productionEligible
            ? 'FRAME_VERIFIED_BUT_ACCEPTANCE_SET_INCOMPLETE'
            : 'CALIBRATED_LAYOUT_FOUND_BUT_REQUIRED_FIELDS_UNVERIFIED',
        deterministicScreen: {
          ...deterministic,
          fieldVerification,
          captureEnvironment: auditMeta.captureEnvironment,
        },
        captureEnvironment: auditMeta.captureEnvironment,
        rawModelResponseText: null,
        modelCallSkippedReason: deterministic.reasonCode || 'DETERMINISTIC_SCREEN_REJECT',
        preflight: analysisPreflight,
        gateSnapshot: {
          modelProposedBias: 'NEUTRAL',
          preAuditBias: 'NEUTRAL',
          finalBias: 'NEUTRAL',
          finalReason: neutral.gateReason || 'DETERMINISTIC_SCREEN_REJECT',
        },
        timingsMs: {
          capture: auditMeta.captureMs,
          preflight: auditMeta.preflightMs,
          deterministicScreen: deterministicScreenMs,
          aiCall: null,
          gates: 0,
          totalCaptureToDecision,
        },
        nullReasons: {
          entryPrice: 'STRUCTURED_FIELD_READER_STAGE4_NOT_ACTIVE',
          ...(fieldVerification?.payout.payoutDecimal === null
            ? { payout: fieldVerification?.payout.reasonCode || 'PAYOUT_UNREADABLE' }
            : {}),
          expiry: 'STRUCTURED_FIELD_READER_STAGE4_NOT_ACTIVE',
          deterministicTimeframe: deterministic.timeframe.reasonCode || 'TIMEFRAME_UNVERIFIED',
          ...(fieldVerification?.timeframeDiagnostics.subReasons.length
            ? { timeframeSubReasons: fieldVerification.timeframeDiagnostics.subReasons.map((item) => item.code).join('|') }
            : {}),
          deterministicAsset: deterministic.asset.reasonCode || 'ASSET_UNVERIFIED',
          priceAxis: deterministic.priceAxis.reasonCode || 'PRICE_AXIS_UNREADABLE',
          timeAxis: deterministic.timeAxis.reasonCode || 'TIME_AXIS_UNREADABLE',
        },
        durableWrite: 'pending',
        createdAt: new Date().toISOString(),
      };

      try {
        await persistRecord(reproRecord);
      } catch (auditError) {
        setError(`Audit warning: deterministic reject stayed NEUTRAL, but reproducibility logging failed: ${auditError instanceof Error ? auditError.message : 'unknown error'}`);
      }
      const timeframeDetail = fieldVerification?.timeframeDiagnostics.subReasons
        .map((item) => item.message)
        .join(' ');
      setError(
        `Blocked before AI: ${deterministic.reasonCode || 'DETERMINISTIC_SCREEN_REJECT'}.`
        + (timeframeDetail ? ` ${timeframeDetail}` : '')
        + ' No model image was sent.',
      );
      return neutral;
    }

    const primaryCrop = deterministic.crops.find((crop) => crop.role === 'primary');
    if (!primaryCrop) throw new Error('LAYOUT_NOT_FOUND: calibrated primary crop is missing.');

    const primaryPreflightStartedAt = performance.now();
    const primaryPreflight = await analyzeImagePreflight(primaryCrop.dataUrl);
    const primaryPreflightMs = Math.round(performance.now() - primaryPreflightStartedAt);
    if (primaryPreflight.status === 'block') {
      const rejected = createDeterministicNeutralSignal({
        ...deterministic,
        safeForAi: false,
        reasonCode: 'LAYOUT_NOT_FOUND',
        reasons: [...deterministic.reasons, 'LAYOUT_NOT_FOUND'],
      });
      rejected.gateReason = 'PIXEL_PREFLIGHT_BLOCK: verified crop failed deterministic pixel preflight. AI was not called.';
      setSignal(rejected);
      setResponseTime(null);
      return rejected;
    }

    // Single-frame audit mode: no independently uploaded M5/H1 image is ever
    // attached to the decision. The AI receives only the verified primary crop.
    const result = await analyzeChartWithGroq({
      apiKey,
      image: primaryCrop.dataUrl,
      minConfidence,
      preflight: primaryPreflight,
      contextImages: [],
    });
    const researchFilteredSignal = applyPrecisionProfile(result.signal, precisionProfile);
    const auditGateStartedAt = performance.now();
    const gatedSignal = applyAuditEdgeGate(researchFilteredSignal);
    const auditGateMs = Math.round(performance.now() - auditGateStartedAt);
    const decisionAt = new Date().toISOString();

    setSignal(gatedSignal);
    setResponseTime(result.responseTimeMs);
    setHistory((current) => [createHistoryItem(gatedSignal, result.responseTimeMs, minConfidence), ...current].slice(0, HISTORY_LIMIT));

    void appendAuditSignal(createAuditSignalRecord({
      signal: gatedSignal,
      source,
      capturedAt: auditMeta.capturedAt,
      decisionAt,
      entryPrice: null,
      entryTimestamp: null,
      expiryTimestamp: null,
      expirySeconds: null,
      payout: fieldVerification?.payout.payoutDecimal ?? null,
      payoutBreakevenWinRate: fieldVerification?.payout.breakevenWinRate ?? null,
      payoutReadReason: fieldVerification?.payout.reasonCode ?? null,
      platformClockUtc: fieldVerification?.platformClock.parsedText ?? null,
      secondsIntoCandle: fieldVerification?.platformClock.secondsIntoCandle ?? null,
      chartType: fieldVerification?.chartType.detected ?? null,
      priceAxisMin: fieldVerification?.priceAxis.min ?? null,
      priceAxisMax: fieldVerification?.priceAxis.max ?? null,
      priceAxisR2: fieldVerification?.priceAxis.r2 ?? null,
      timeframeDisagreement: fieldVerification?.timeframeDisagreement ?? null,
      fieldLegibility: fieldVerification?.legibility ?? null,
      outcome: 'NEUTRAL',
      feed: primarySource === 'live' ? 'Quotex shared-tab visual feed' : 'Uploaded chart image; feed unknown',
      rawDataRef: primaryCrop ? artifacts.find((artifact) => artifact.role === 'primary')?.sha256 || null : null,
    })).catch(() => undefined);

    const decisionMs = Date.parse(decisionAt);
    const totalCaptureToDecision = Number.isFinite(capturedMs) && Number.isFinite(decisionMs)
      ? Math.max(0, decisionMs - capturedMs)
      : null;

    const reproRecord: ReproDecisionRecord = {
      schemaVersion: 'decision-record-v1',
      recordId: newRecordId(),
      configVersion: INPUT_PIPELINE_CONFIG_VERSION,
      promptVersion: GROQ_PROMPT_VERSION,
      modelName: GROQ_MODEL,
      temperature: GROQ_TEMPERATURE,
      seed: GROQ_SEED,
      seedReason: 'Fixed before outcome analysis for best-effort reproducibility; Groq does not guarantee determinism.',
      systemFingerprint: result.systemFingerprint,
      capturedAt: auditMeta.capturedAt,
      decisionAt,
      source,
      configuredTimeframe: 'M1',
      layoutProfileVersion: LAYOUT_PROFILE_VERSION,
      layoutReason: 'CALIBRATED_LAYOUT_AND_DETERMINISTIC_CHECKS_PASSED',
      deterministicScreen: { ...deterministic, fieldVerification },
      rawModelResponseText: result.rawApiResponseText,
      modelCallSkippedReason: null,
      preflight: primaryPreflight,
      gateSnapshot: {
        modelProposedBias: result.signal.proposedBias,
        preAuditBias: researchFilteredSignal.bias,
        finalBias: 'NEUTRAL',
        finalReason: gatedSignal.gateReason || 'AUDIT_LOCK',
      },
      timingsMs: {
        capture: auditMeta.captureMs,
        preflight: primaryPreflightMs,
        deterministicScreen: deterministicScreenMs,
        aiCall: result.aiCallMs,
        gates: result.gatesMs + auditGateMs,
        totalCaptureToDecision,
      },
      nullReasons: {
        entryPrice: 'STRUCTURED_FIELD_READER_PENDING_STAGE4',
        ...(fieldVerification?.payout.payoutDecimal === null
          ? { payout: fieldVerification?.payout.reasonCode || 'PAYOUT_UNREADABLE' }
          : {}),
        expiry: 'STRUCTURED_FIELD_READER_PENDING_STAGE4',
      },
      durableWrite: 'pending',
      createdAt: new Date().toISOString(),
    };

    try {
      await persistRecord(reproRecord);
    } catch (auditError) {
      setError(`Audit warning: decision remained NEUTRAL, but reproducibility logging failed: ${auditError instanceof Error ? auditError.message : 'unknown error'}`);
    }

    return gatedSignal;
  };

  const handleToggleAutoTest = () => {
    if (autoRunningRef.current) {
      stopAutoTest();
      return;
    }
    if (!apiKey.trim()) {
      setError('Authenticate the secure audit session before starting Auto Test.');
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
      setError('Auto Test stopped because the secure audit session is not authenticated.');
      stopAutoTest('error');
      return;
    }

    autoCycleBusyRef.current = true;
    setAutoStats((current) => ({ ...current, status: 'capturing' }));

    try {
      const captured = await captureLiveTabFrameDetailed(stream as MediaStream);
      const frame = captured.dataUrl;
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
      const preflightStartedAt = performance.now();
      const quality = await inspectPrimaryFrame(frame, 'live');
      const preflightMs = Math.round(performance.now() - preflightStartedAt);

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
      const resultSignal = await executeAiAnalysis(frame, quality, {
        capturedAt: captured.capturedAt,
        captureMs: captured.captureMs,
        preflightMs,
        sourceFrameSize: { width: captured.sourceWidth, height: captured.sourceHeight },
        captureEnvironment: captured.environment,
      });
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
      setError('Authenticate the secure audit session first.');
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
      let auditMeta = {
        capturedAt: null as string | null,
        captureMs: null as number | null,
        preflightMs: null as number | null,
        sourceFrameSize: null as { width: number; height: number } | null,
        captureEnvironment: null as CaptureEnvironment | null,
      };

      if (liveTabActive) {
        setAnalysisStage('capturing');
        setPreflightLoading(true);
        const freshFrame = await captureFreshLiveFrame();
        analysisImage = freshFrame.image;
        analysisPreflight = freshFrame.preflight;
        auditMeta = {
          capturedAt: freshFrame.capturedAt,
          captureMs: freshFrame.captureMs,
          preflightMs: freshFrame.preflightMs,
          sourceFrameSize: freshFrame.sourceFrameSize,
          captureEnvironment: freshFrame.captureEnvironment,
        };
      } else if (analysisImage) {
        const preflightStartedAt = performance.now();
        analysisPreflight = await analyzeImagePreflight(analysisImage);
        auditMeta.preflightMs = Math.round(performance.now() - preflightStartedAt);
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
      await executeAiAnalysis(analysisImage, analysisPreflight, auditMeta);
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
    setScreenDiagnostics(null);
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

      <main className="mx-auto max-w-[1480px] px-4 py-5">
        <SecurityPanel
          authenticated={authVerified}
          authConfigured={Boolean(serverHealth?.authConfigured)}
          groqConfigured={Boolean(serverHealth?.groqConfigured)}
          tokenPresent={Boolean(auditToken)}
          busy={securityBusy}
          onAuthenticate={handleAuthenticate}
          onLogout={handleLogout}
        />

        {!image ? (
          <UploadPanel onUpload={handleImageUpload} onStartLiveTab={() => void handleStartLiveTab()} liveTabSupported={liveTabSupported} liveTabBusy={liveTabBusy} />
        ) : (
          <div className="space-y-2">
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[9px] font-black uppercase tracking-wider text-yellow-300">🔒 AUDIT LOCK · NEUTRAL-ONLY</div>
                  <div className="mt-0.5 text-[9px] text-slate-500">
                    No clean payout-aware Quotex holdout has yet proven a Wilson 95% lower bound above breakeven. CALL/PUT proposals are logged for research but final output remains NEUTRAL.
                  </div>
                </div>
                <span className="shrink-0 rounded border border-yellow-500/20 bg-yellow-500/10 px-2 py-1 text-[8px] font-black text-yellow-300">UNPROVEN EDGE</span>
              </div>
            </div>

            {signal && (
              <SignalCard signal={signal} onRetry={() => void analyzeChart()} analyzing={analyzing} minConfidence={minConfidence} />
            )}

            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-3 items-start">
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
                      className="h-[64vh] min-h-[440px] max-h-[760px] w-full object-contain"
                    />
                  ) : (
                    <img src={image} alt="Primary chart frame" className="h-[64vh] min-h-[440px] max-h-[760px] w-full object-contain" />
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
                    onIntervalChange={handleAutoIntervalChange}
                  />
                )}

                <ImagePreflightPanel result={preflight} loading={preflightLoading} />

                {screenDiagnostics?.verification && (
                  <details open className="rounded-lg border border-amber-500/30 bg-amber-500/5">
                    <summary className="cursor-pointer px-3 py-2 text-[10px] font-black uppercase tracking-wider text-amber-300">
                      🔎 Timeframe diagnostics
                    </summary>
                    <div className="space-y-2 border-t border-amber-500/20 p-2.5 text-[9px] text-slate-400">
                      <div className="grid grid-cols-2 gap-1 font-mono">
                        <span>Frame</span>
                        <span>{screenDiagnostics.sourceFrameSize ? `${screenDiagnostics.sourceFrameSize.width}×${screenDiagnostics.sourceFrameSize.height}` : 'unknown'}</span>
                        <span>Layout located</span>
                        <span>{screenDiagnostics.layoutFound ? 'YES' : 'NO'}</span>
                        <span>devicePixelRatio</span>
                        <span>{screenDiagnostics.captureEnvironment?.devicePixelRatio ?? 'not recorded'}</span>
                        <span>visualViewport.scale</span>
                        <span>{screenDiagnostics.captureEnvironment?.visualViewportScale ?? 'not recorded'}</span>
                        <span>Browser zoom</span>
                        <span>{screenDiagnostics.captureEnvironment?.browserZoomPercent ?? 'not reliably detectable'}</span>
                        <span>Badge score</span>
                        <span>
                          {screenDiagnostics.verification.timeframeDiagnostics.badge.score ?? 'null'}
                          {' / '}
                          {screenDiagnostics.verification.timeframeDiagnostics.badge.threshold}
                        </span>
                        <span>Badge scale</span>
                        <span>{screenDiagnostics.verification.timeframeDiagnostics.badge.bestScale ?? 'none'}</span>
                        <span>Usable axis intervals</span>
                        <span>
                          {screenDiagnostics.verification.timeframeDiagnostics.axis.usableIntervals}
                          {' / '}
                          {screenDiagnostics.verification.timeframeDiagnostics.axis.requiredIntervals}
                        </span>
                        <span>Candle pitch</span>
                        <span>{screenDiagnostics.verification.timeframeDiagnostics.axis.candlePitchPx ?? 'null'} px</span>
                        <span>Minutes/candle</span>
                        <span>{screenDiagnostics.verification.timeframeDiagnostics.axis.minutesPerCandle ?? 'null'}</span>
                      </div>

                      {screenDiagnostics.verification.timeframeDiagnostics.subReasons.length > 0 && (
                        <div className="space-y-1">
                          {screenDiagnostics.verification.timeframeDiagnostics.subReasons.map((reason) => (
                            <div key={reason.code} className="rounded border border-red-500/20 bg-red-500/5 px-2 py-1 text-red-300">
                              <span className="font-black">{reason.code}</span> — {reason.message}
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="grid grid-cols-1 gap-2">
                        {screenDiagnostics.verification.timeframeDiagnostics.failedCropRoles.map((role) => {
                          const crop = screenDiagnostics.crops.find((item) => item.role === role);
                          if (!crop) return null;
                          return (
                            <div key={role} className="rounded border border-slate-700 bg-slate-950 p-2">
                              <div className="mb-1 font-mono text-[8px] text-slate-500">
                                {role} crop · x={crop.rect.x} y={crop.rect.y} w={crop.rect.width} h={crop.rect.height}
                              </div>
                              <img src={crop.dataUrl} alt={`${role} diagnostic crop`} className="max-h-28 w-full rounded bg-black object-contain [image-rendering:pixelated]" />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </details>
                )}

                <OutcomeResolverPanel
                  liveTabActive={liveTabActive}
                  authenticated={authVerified}
                  captureSnapshot={captureOutcomeResolverSnapshot}
                />

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
                    onChange={(event: ChangeEvent<HTMLInputElement>) => handleMinConfidenceChange(Number(event.target.value))}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-700 accent-green-500"
                  />
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900/55 p-2.5">
                  <div className="mb-1 text-[9px] font-black uppercase tracking-wider text-slate-500">Configured asset</div>
                  <input
                    value={configuredAsset}
                    onChange={(event) => handleConfiguredAssetChange(event.target.value)}
                    placeholder="e.g. CAD/CHF (OTC)"
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-[10px] font-mono text-slate-200 outline-none focus:border-cyan-500"
                  />
                  <div className="mt-1 text-[8px] leading-relaxed text-slate-600">OCR must match this asset exactly after normalization, otherwise the frame stays NEUTRAL.</div>
                </div>

                <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-2.5">
                  <div className="text-[9px] font-black uppercase tracking-wider text-cyan-300">Stage 3B validation lock</div>
                  <div className="mt-1 text-[8px] leading-relaxed text-slate-500">Explicit 1m badge + time-axis/candle-pitch + asset OCR + price/time axes are checked. Production AI remains blocked until multi-session / multi-asset / multi-window validation is complete.</div>
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

                <div className="rounded-lg border border-slate-800 bg-slate-900/45 p-2.5">
                  <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Single-frame audit mode</div>
                  <div className="mt-1 text-[9px] leading-relaxed text-slate-600">Independent M5/H1 uploads are disabled for decisions. All decision crops must come from one captured frame.</div>
                </div>

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

      <footer className="border-t border-slate-900 py-4 mt-8"><div className="mx-auto max-w-[1480px] px-4 text-center text-[10px] text-slate-600">Stage 11 • documented settlement resolver • 30-demo agreement validation pending • AUDIT LOCK ON</div></footer>
    </div>
  );
}

export default App;
