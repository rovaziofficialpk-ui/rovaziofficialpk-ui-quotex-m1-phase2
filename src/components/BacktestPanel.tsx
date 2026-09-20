import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  BACKTEST_REQUEST_DELAY_MS,
  BACKTEST_WINDOW_CANDLES,
  COMMON_QUOTEX_FOREX_PAIRS,
  buildBacktestIndexes,
  createBacktestRow,
  delay,
  exportBacktestCsv,
  exportBacktestJson,
  parseBacktestCsv,
  renderBacktestChart,
  summarizeBacktest,
  type BacktestMarket,
  type BacktestRow,
  type ParsedBacktestData,
} from '../services/backtest';
import { analyzeChartWithGroq, humanizeGroqError } from '../services/groq';
import { analyzeImagePreflight } from '../services/imagePreflight';
import {
  PRECISION_MIN_HOLDOUT_SIGNALS,
  PRECISION_TARGET_WIN_RATE,
  optimizePrecisionProfile,
  type PrecisionProfile,
} from '../services/precisionOptimizer';

interface BacktestPanelProps {
  apiKey: string;
  minConfidence: number;
  activePrecisionProfile: PrecisionProfile | null;
  onApplyPrecisionProfile: (profile: PrecisionProfile) => void;
  onClose: () => void;
}

const SAMPLE_OPTIONS = [10, 25, 50, 100, 250];

export function BacktestPanel({ apiKey, minConfidence, activePrecisionProfile, onApplyPrecisionProfile, onClose }: BacktestPanelProps) {
  const stopRef = useRef(false);
  const [market, setMarket] = useState<BacktestMarket>('FOREX');
  const [pair, setPair] = useState<string>('EUR/USD');
  const [customPair, setCustomPair] = useState('');
  const [samples, setSamples] = useState(25);
  const [fileName, setFileName] = useState('');
  const [dataset, setDataset] = useState<ParsedBacktestData | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [rows, setRows] = useState<BacktestRow[]>([]);
  const [error, setError] = useState('');
  const [runLabel, setRunLabel] = useState('');

  const summary = useMemo(() => summarizeBacktest(rows), [rows]);
  const optimization = useMemo(
    () => rows.length >= 40
      ? optimizePrecisionProfile(rows, rows[0]?.pair || pair, rows[0]?.market || market)
      : null,
    [rows],
  );
  const optimizedProfile = optimization?.profile || null;
  const selectedPair = pair === 'CUSTOM'
    ? customPair.trim().toUpperCase()
    : pair;
  const displayPair = market === 'OTC' ? `${selectedPair} OTC` : selectedPair;
  const estimatedMinutes = Math.max(1, Math.ceil((samples * BACKTEST_REQUEST_DELAY_MS) / 60_000));

  const handleCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError('');
    setRows([]);
    try {
      const text = await file.text();
      const parsed = parseBacktestCsv(text);
      setDataset(parsed);
      setFileName(file.name);
    } catch (err) {
      setDataset(null);
      setFileName('');
      setError(err instanceof Error ? err.message : 'Could not parse this CSV.');
    }
  };

  const stop = () => {
    stopRef.current = true;
    setRunLabel('Stopping after current AI request…');
  };

  const run = async () => {
    if (running) return;
    if (!apiKey.trim()) {
      setError('Add your Groq API key in the main dashboard first.');
      return;
    }
    if (!dataset) {
      setError('Upload M1 OHLC CSV data first.');
      return;
    }
    if (!selectedPair) {
      setError('Choose or enter a currency pair.');
      return;
    }
    if (dataset.timeframeStatus === 'not_m1') {
      setError(`Dataset interval looks like ${dataset.medianIntervalSeconds}s, not M1. Use 1-minute candles.`);
      return;
    }

    const indexes = buildBacktestIndexes(dataset.candles.length, samples);
    if (!indexes.length) {
      setError('This dataset does not contain enough eligible decision points.');
      return;
    }

    stopRef.current = false;
    setRunning(true);
    setRows([]);
    setError('');
    setProgress({ done: 0, total: indexes.length });
    setRunLabel('Preparing historical replay…');

    const completed: BacktestRow[] = [];

    try {
      for (let sampleIndex = 0; sampleIndex < indexes.length; sampleIndex += 1) {
        if (stopRef.current) break;

        const decisionIndex = indexes[sampleIndex];
        const decision = dataset.candles[decisionIndex];
        const expiry = dataset.candles[decisionIndex + 1];
        const window = dataset.candles.slice(
          decisionIndex - BACKTEST_WINDOW_CANDLES + 1,
          decisionIndex + 1,
        );

        setRunLabel(`Rendering ${displayPair} • sample ${sampleIndex + 1}/${indexes.length}`);
        const image = renderBacktestChart(window, displayPair, decision.timeLabel);
        const preflight = await analyzeImagePreflight(image);

        if (preflight.status === 'block') {
          throw new Error('Generated replay chart failed local image preflight. Stop and retry after refreshing the app.');
        }

        setRunLabel(`AI replay ${sampleIndex + 1}/${indexes.length} • same Phase 3 gates`);
        const result = await analyzeChartWithGroq({
          apiKey,
          image,
          minConfidence,
          preflight,
          contextImages: [],
        });

        const row = createBacktestRow({
          index: decisionIndex,
          pair: selectedPair,
          market,
          decision,
          expiry,
          signal: result.signal,
          responseTimeMs: result.responseTimeMs,
        });

        completed.push(row);
        setRows([...completed]);
        setProgress({ done: completed.length, total: indexes.length });

        if (sampleIndex < indexes.length - 1 && !stopRef.current) {
          setRunLabel('API pacing • waiting before next historical sample…');
          await delay(BACKTEST_REQUEST_DELAY_MS);
        }
      }

      setRunLabel(stopRef.current ? 'Stopped by user.' : 'Backtest complete.');
    } catch (err) {
      setError(humanizeGroqError(err));
      setRunLabel('Backtest stopped.');
    } finally {
      setRunning(false);
      stopRef.current = false;
    }
  };

  const timeframeLabel = dataset?.timeframeStatus === 'm1'
    ? `M1 verified • median ${dataset.medianIntervalSeconds}s`
    : dataset?.timeframeStatus === 'not_m1'
      ? `Not M1 • median ${dataset.medianIntervalSeconds}s`
      : 'Timestamp interval unknown • rows will be treated as ordered M1';

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 p-3 backdrop-blur-sm">
      <div className="mx-auto flex h-[calc(100vh-24px)] max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#0a0e1a] shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div>
            <div className="text-sm font-black">🧪 Phase 4A · Forex Backtest Lab</div>
            <div className="text-[10px] text-slate-500">Historical M1 replay through the same vision model + current signal gates</div>
          </div>
          <button
            onClick={onClose}
            disabled={running}
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-800 disabled:opacity-40"
          >
            Close
          </button>
        </header>

        <div className="grid flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="overflow-y-auto border-b border-slate-800 p-3 xl:border-b-0 xl:border-r">
            <div className="space-y-3">
              <Section title="1 · Market">
                <div className="grid grid-cols-2 gap-2">
                  {(['FOREX', 'OTC'] as BacktestMarket[]).map((value) => (
                    <button
                      key={value}
                      onClick={() => !running && setMarket(value)}
                      className={`rounded-lg border px-3 py-2 text-xs font-black ${market === value ? 'border-cyan-400 bg-cyan-500/10 text-cyan-300' : 'border-slate-800 bg-slate-950 text-slate-500'}`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[9px] leading-relaxed text-slate-600">
                  OTC must use actual OTC candle data. Normal FOREX and OTC results are never mixed.
                </p>
              </Section>

              <Section title="2 · Currency pair">
                <select
                  value={pair}
                  disabled={running}
                  onChange={(event) => setPair(event.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200"
                >
                  {COMMON_QUOTEX_FOREX_PAIRS.map((value) => <option key={value} value={value}>{value}</option>)}
                  <option value="CUSTOM">Custom pair…</option>
                </select>
                {pair === 'CUSTOM' && (
                  <input
                    value={customPair}
                    disabled={running}
                    onChange={(event) => setCustomPair(event.target.value)}
                    placeholder="e.g. USD/BRL"
                    className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-cyan-400"
                  />
                )}
                <div className="mt-2 rounded bg-slate-950/70 px-2 py-1.5 text-[10px] font-bold text-cyan-300">
                  Replay label: {displayPair || '—'}
                </div>
              </Section>

              <Section title="3 · M1 OHLC CSV">
                <label className="block cursor-pointer rounded-lg border border-dashed border-slate-700 bg-slate-950/60 p-3 text-center hover:border-cyan-400">
                  <div className="text-xs font-bold text-slate-300">{fileName || 'Choose CSV file'}</div>
                  <div className="mt-1 text-[9px] text-slate-600">Headers: time/date + open + high + low + close</div>
                  <input type="file" accept=".csv,text/csv" className="hidden" disabled={running} onChange={handleCsv} />
                </label>
                {dataset && (
                  <div className="mt-2 space-y-1 text-[9px] text-slate-500">
                    <div className={dataset.timeframeStatus === 'not_m1' ? 'text-red-400' : dataset.timeframeStatus === 'm1' ? 'text-green-400' : 'text-yellow-400'}>{timeframeLabel}</div>
                    <div>{dataset.candles.length} valid candles · {dataset.rejectedRows} rejected rows</div>
                  </div>
                )}
              </Section>

              <Section title="4 · Test size">
                <div className="grid grid-cols-5 gap-1">
                  {SAMPLE_OPTIONS.map((value) => (
                    <button
                      key={value}
                      disabled={running}
                      onClick={() => setSamples(value)}
                      className={`rounded border px-1 py-1.5 text-[9px] font-black ${samples === value ? 'border-green-400 bg-green-500/10 text-green-300' : 'border-slate-800 bg-slate-950 text-slate-500'}`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <div className="mt-2 text-[9px] text-slate-600">
                  Up to {samples} Groq vision calls · estimated pacing ≥{estimatedMinutes} min. Samples are spread across the dataset.
                </div>
              </Section>

              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-[9px] leading-relaxed text-slate-500">
                <span className="font-bold text-slate-300">Outcome rule:</span> decision at the final visible M1 close; expiry at the next M1 close. CALL=up, PUT=down, equal close=tie.
              </div>

              {!running ? (
                <button
                  onClick={() => void run()}
                  className="w-full rounded-lg bg-green-500 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-green-400"
                >
                  ▶ RUN BACKTEST
                </button>
              ) : (
                <button
                  onClick={stop}
                  className="w-full rounded-lg bg-red-500/20 px-4 py-2.5 text-xs font-black text-red-300 hover:bg-red-500/30"
                >
                  ■ STOP AFTER CURRENT REQUEST
                </button>
              )}

              {running && (
                <div>
                  <div className="mb-1 flex justify-between text-[9px] text-slate-500">
                    <span>{runLabel}</span>
                    <span>{progress.done}/{progress.total}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded bg-slate-800">
                    <div
                      className="h-full bg-cyan-400 transition-all"
                      style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

              {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-[10px] text-red-300">{error}</div>}
            </div>
          </aside>

          <main className="overflow-y-auto p-3">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
              <Metric label="Analyzed" value={String(summary.analyzed)} />
              <Metric label="Signals" value={String(summary.directional)} />
              <Metric label="Neutral" value={String(summary.neutral)} />
              <Metric label="Wins" value={String(summary.wins)} tone="text-green-400" />
              <Metric label="Losses" value={String(summary.losses)} tone="text-red-400" />
              <Metric label="Win rate" value={summary.winRate === null ? '—' : `${summary.winRate}%`} tone="text-cyan-300" />
              <Metric label="Coverage" value={`${summary.coverage}%`} />
            </div>

            <div className="mt-3 rounded-xl border border-purple-500/30 bg-purple-500/5 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-wider text-purple-300">🎯 Precision Optimizer · target {PRECISION_TARGET_WIN_RATE}%+</div>
                  <div className="mt-1 max-w-2xl text-[9px] leading-relaxed text-slate-500">
                    Chooses stricter rules using only the first 70% of replay results, then scores that frozen rule on the untouched final 30%.
                  </div>
                </div>
                {activePrecisionProfile && (
                  <div className="rounded border border-green-500/30 bg-green-500/10 px-2 py-1 text-[9px] font-black text-green-300">
                    LIVE PROFILE: {activePrecisionProfile.sourcePair} · {activePrecisionProfile.holdout.winRate ?? '—'}%
                  </div>
                )}
              </div>

              {!optimization ? (
                <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-[10px] text-slate-500">
                  Run at least 40 historical replay samples to unlock train → holdout optimization. For stronger evidence, use 100–250 samples.
                </div>
              ) : !optimizedProfile ? (
                <div className="mt-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 text-[10px] text-yellow-300">
                  No rule had enough training signals to optimize safely. Increase the backtest sample size.
                </div>
              ) : (
                <>
                  <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                    <OptimizerMetric label="Train win rate" value={optimizedProfile.train.winRate === null ? '—' : `${optimizedProfile.train.winRate}%`} />
                    <OptimizerMetric label="Train signals" value={String(optimizedProfile.train.signals)} />
                    <OptimizerMetric label="Holdout win rate" value={optimizedProfile.holdout.winRate === null ? '—' : `${optimizedProfile.holdout.winRate}%`} tone={optimizedProfile.validated ? 'text-green-400' : 'text-yellow-300'} />
                    <OptimizerMetric label="Holdout signals" value={String(optimizedProfile.holdout.signals)} />
                  </div>

                  <div className="mt-2 grid gap-2 lg:grid-cols-[1fr_auto]">
                    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-[9px] leading-relaxed text-slate-400">
                      <span className="font-black text-slate-200">Chosen frozen rule:</span>
                      {' '}confidence ≥ {optimizedProfile.rule.minConfidence}% · confirmations ≥ {optimizedProfile.rule.minConfirmations}/4 · opposing ≤ {optimizedProfile.rule.maxOpposing}
                      {' '}· quality {optimizedProfile.rule.requireClear ? 'CLEAR only' : 'clear/usable'}
                      {' '}· warnings ≤ {optimizedProfile.rule.maxWarnings >= 99 ? 'any' : optimizedProfile.rule.maxWarnings}
                      {' '}· side {optimizedProfile.rule.biasMode}
                      <div className="mt-1 text-slate-600">
                        Train {optimization.trainRows} rows · holdout {optimization.holdoutRows} rows · {optimization.candidatesTested} candidate rules tested on train only.
                      </div>
                    </div>

                    {optimizedProfile.validated ? (
                      <button
                        onClick={() => onApplyPrecisionProfile(optimizedProfile)}
                        className="rounded-lg bg-green-500 px-4 py-2 text-[10px] font-black text-slate-950 hover:bg-green-400"
                      >
                        ✓ APPLY VALIDATED PROFILE
                      </button>
                    ) : (
                      <div className="flex max-w-[260px] items-center rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-[9px] leading-relaxed text-yellow-200">
                        Not enabled live: {optimizedProfile.validationReason}
                      </div>
                    )}
                  </div>

                  <div className={`mt-2 rounded-lg border p-2 text-[9px] leading-relaxed ${optimizedProfile.validated ? 'border-green-500/20 bg-green-500/5 text-green-200' : 'border-slate-800 bg-slate-950/50 text-slate-500'}`}>
                    {optimizedProfile.validated
                      ? `80%+ holdout threshold passed with at least ${PRECISION_MIN_HOLDOUT_SIGNALS} decided holdout signals. This is historical validation, not a guarantee of future outcomes.`
                      : `Target not validated yet. The optimizer will not claim 80%+ or change live signals until the untouched holdout itself reaches ${PRECISION_TARGET_WIN_RATE}%+ with enough signals.`}
                  </div>
                </>
              )}
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <Card title="Confirmation performance">
                <BucketRow bucket={summary.confirm3} />
                <BucketRow bucket={summary.confirm4} />
              </Card>

              <Card title="Confidence buckets">
                {summary.confidenceBuckets.map((bucket) => <BucketRow key={bucket.label} bucket={bucket} />)}
              </Card>
            </div>

            <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/45">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">Replay results</div>
                  <div className="text-[9px] text-slate-600">Observed historical outcome is kept separate from AI confidence.</div>
                </div>
                {rows.length > 0 && (
                  <div className="flex gap-1.5">
                    <button onClick={() => exportBacktestJson(rows, summary)} className="rounded bg-slate-800 px-2 py-1 text-[9px] font-bold text-slate-300">JSON</button>
                    <button onClick={() => exportBacktestCsv(rows)} className="rounded bg-slate-800 px-2 py-1 text-[9px] font-bold text-slate-300">CSV</button>
                  </div>
                )}
              </div>

              {rows.length === 0 ? (
                <div className="p-10 text-center">
                  <div className="text-4xl">📊</div>
                  <div className="mt-2 text-sm font-black text-slate-300">No backtest results yet</div>
                  <div className="mt-1 text-[10px] text-slate-600">Upload M1 OHLC CSV and run the frozen current signal logic.</div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-left text-[9px]">
                    <thead className="bg-slate-950/80 uppercase tracking-wider text-slate-600">
                      <tr>
                        <th className="px-2 py-2">Time</th>
                        <th className="px-2 py-2">Signal</th>
                        <th className="px-2 py-2">Conf</th>
                        <th className="px-2 py-2">Confirm</th>
                        <th className="px-2 py-2">Actual</th>
                        <th className="px-2 py-2">Outcome</th>
                        <th className="px-2 py-2">Pattern / Gate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...rows].reverse().slice(0, 100).map((row, index) => (
                        <tr key={`${row.timestamp}-${index}`} className="border-t border-slate-800/70 text-slate-400">
                          <td className="whitespace-nowrap px-2 py-2 font-mono">{row.timeLabel}</td>
                          <td className={`px-2 py-2 font-black ${row.bias === 'CALL' ? 'text-green-400' : row.bias === 'PUT' ? 'text-red-400' : 'text-yellow-400'}`}>{row.bias}</td>
                          <td className="px-2 py-2">{row.confidence}%</td>
                          <td className="px-2 py-2">{row.confirmationCount}/4</td>
                          <td className="px-2 py-2">{row.actualDirection}</td>
                          <td className={`px-2 py-2 font-black ${row.outcome === 'WIN' ? 'text-green-400' : row.outcome === 'LOSS' ? 'text-red-400' : row.outcome === 'TIE' ? 'text-blue-300' : 'text-slate-600'}`}>{row.outcome}</td>
                          <td className="max-w-[320px] truncate px-2 py-2" title={row.gateReason || row.pattern}>{row.gateReason || row.pattern}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="mt-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-2 text-[9px] leading-relaxed text-yellow-200/70">
              For normal forex, third-party M1 candles are a benchmark and may not match Quotex tick-for-tick. For OTC, use actual captured/exported OTC candle data; ordinary forex history is not treated as OTC history.
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-lg border border-slate-800 bg-slate-900/45 p-2.5"><div className="mb-2 text-[9px] font-black uppercase tracking-wider text-slate-500">{title}</div>{children}</div>;
}

function OptimizerMetric({ label, value, tone = 'text-slate-200' }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-2"><div className="text-[8px] uppercase tracking-wider text-slate-600">{label}</div><div className={`mt-0.5 text-sm font-black ${tone}`}>{value}</div></div>;
}

function Metric({ label, value, tone = 'text-slate-200' }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-lg border border-slate-800 bg-slate-900/55 px-2 py-2"><div className="text-[8px] uppercase tracking-wider text-slate-600">{label}</div><div className={`mt-0.5 text-base font-black ${tone}`}>{value}</div></div>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-900/45 p-3"><div className="mb-2 text-[9px] font-black uppercase tracking-wider text-slate-500">{title}</div><div className="space-y-1.5">{children}</div></div>;
}

function BucketRow({ bucket }: { bucket: ReturnType<typeof summarizeBacktest>['confirm3'] }) {
  return (
    <div className="grid grid-cols-[1fr_52px_52px_64px] items-center gap-2 rounded bg-slate-950/60 px-2 py-1.5 text-[9px]">
      <span className="text-slate-400">{bucket.label}</span>
      <span className="text-center text-slate-500">{bucket.signals} sig</span>
      <span className="text-center text-green-400">{bucket.wins}W</span>
      <span className="text-right font-black text-cyan-300">{bucket.winRate === null ? '—' : `${bucket.winRate}%`}</span>
    </div>
  );
}
