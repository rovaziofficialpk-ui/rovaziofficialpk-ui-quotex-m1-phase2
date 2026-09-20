import { useEffect, useMemo, useRef, useState } from 'react';
import {
  REQUIRED_DEMO_TRADES,
  appendOutcomeEvent,
  foldOutcomeTrades,
  loadOutcomeEvents,
  makeArmedEvent,
  makeExpiredEvent,
  makeManualOutcomeEvent,
  summarizeOutcomeTrades,
  type ManualPlatformOutcome,
  type ResolverDirection,
  type ResolverSnapshot,
} from '../services/outcomeResolver';

interface OutcomeResolverPanelProps {
  liveTabActive: boolean;
  authenticated: boolean;
  captureSnapshot: () => Promise<ResolverSnapshot>;
}

export function OutcomeResolverPanel({ liveTabActive, authenticated, captureSnapshot }: OutcomeResolverPanelProps) {
  const [events, setEvents] = useState<Awaited<ReturnType<typeof loadOutcomeEvents>>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const timerRef = useRef<number | null>(null);

  const trades = useMemo(() => foldOutcomeTrades(events), [events]);
  const summary = useMemo(() => summarizeOutcomeTrades(trades), [trades]);
  const pending = trades.find((trade) => trade.expiry === null) || null;

  const refresh = async () => {
    if (!authenticated) return;
    try {
      setEvents(await loadOutcomeEvents());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load resolver events.');
    }
  };

  useEffect(() => { void refresh(); }, [authenticated]);

  useEffect(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    if (!pending || !liveTabActive || !authenticated) return;
    const delay = Math.max(0, Date.parse(pending.dueAt) - Date.now());
    timerRef.current = window.setTimeout(() => { void resolvePending(pending.tradeId); }, delay);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [pending?.tradeId, pending?.dueAt, liveTabActive, authenticated]);

  const arm = async (direction: ResolverDirection) => {
    if (!liveTabActive || !authenticated || pending) return;
    setBusy(true);
    setMessage('');
    try {
      const entry = await captureSnapshot();
      const event = makeArmedEvent(direction, entry);
      await appendOutcomeEvent(event);
      setEvents((current) => [...current, event]);
      setMessage(`Recorded ${direction} demo reference. The app did not place a trade. Expiry capture is scheduled for +60s.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not arm resolver.');
    } finally {
      setBusy(false);
    }
  };

  const resolvePending = async (tradeId: string) => {
    const trade = trades.find((item) => item.tradeId === tradeId);
    if (!trade || trade.expiry || !liveTabActive || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const expiry = await captureSnapshot();
      const event = makeExpiredEvent(trade.tradeId, trade.direction, trade.entry, expiry);
      await appendOutcomeEvent(event);
      setEvents((current) => [...current, event]);
      setMessage(event.payload.resolverOutcome
        ? `Screen resolver: ${event.payload.resolverOutcome}. Now mark the result Quotex demo actually displayed.`
        : `Resolver outcome is null: ${event.payload.resolverNullReason}. Do not guess it.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Expiry capture failed.');
    } finally {
      setBusy(false);
    }
  };

  const labelPlatform = async (tradeId: string, outcome: ManualPlatformOutcome) => {
    setBusy(true);
    setMessage('');
    try {
      const event = makeManualOutcomeEvent(tradeId, outcome);
      await appendOutcomeEvent(event);
      setEvents((current) => [...current, event]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save manual platform outcome.');
    } finally {
      setBusy(false);
    }
  };

  const unlabeled = trades.filter((trade) => trade.expiry && !trade.platformOutcome).slice(0, 3);

  return (
    <details className="group rounded-lg border border-blue-500/25 bg-blue-500/5">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[10px] font-black uppercase tracking-wider text-blue-300">
        <span>🧾 Stage 11 · Demo outcome resolver</span>
        <span className="text-slate-600 group-open:rotate-90">›</span>
      </summary>
      <div className="space-y-2 border-t border-blue-500/20 p-2.5">
        <div className="text-[8px] leading-relaxed text-slate-500">
          Validation only. You place any demo trade manually in Quotex. This panel never clicks Higher/Lower and never changes the AUDIT LOCK.
        </div>

        <div className="grid grid-cols-3 gap-1">
          <Mini label="Demo labels" value={`${summary.manuallyLabeled}/${REQUIRED_DEMO_TRADES}`} />
          <Mini label="Agreement" value={summary.agreementRate === null ? '—' : `${summary.agreementRate}%`} />
          <Mini label="Null rate" value={summary.resolverNullRate === null ? '—' : `${summary.resolverNullRate}%`} />
        </div>
        <div className="grid grid-cols-2 gap-1">
          <Mini label="Known mean return" value={summary.meanUnitReturnKnown === null ? '—' : summary.meanUnitReturnKnown.toFixed(4)} />
          <Mini label="Full-sample EV" value={summary.fullSampleExpectancy === null ? 'unknown' : summary.fullSampleExpectancy.toFixed(4)} />
        </div>

        {pending ? (
          <div className="rounded border border-yellow-500/20 bg-yellow-500/5 p-2 text-[9px] text-yellow-200">
            Pending {pending.direction} reference · expiry capture due {new Date(pending.dueAt).toLocaleTimeString()}.
            <button disabled={busy || !liveTabActive} onClick={() => void resolvePending(pending.tradeId)} className="ml-2 rounded bg-slate-800 px-2 py-1 text-[8px] font-bold text-slate-300 disabled:opacity-40">Capture now</button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              disabled={busy || !liveTabActive || !authenticated}
              onClick={() => void arm('CALL')}
              className="rounded bg-slate-800 px-2 py-2 text-[9px] font-black text-green-300 disabled:opacity-40"
            >
              Record manual CALL reference
            </button>
            <button
              disabled={busy || !liveTabActive || !authenticated}
              onClick={() => void arm('PUT')}
              className="rounded bg-slate-800 px-2 py-2 text-[9px] font-black text-red-300 disabled:opacity-40"
            >
              Record manual PUT reference
            </button>
          </div>
        )}

        {unlabeled.map((trade) => (
          <div key={trade.tradeId} className="rounded border border-slate-800 bg-slate-950/60 p-2">
            <div className="mb-1 text-[8px] text-slate-500">
              {new Date(trade.armedAt).toLocaleTimeString()} · {trade.direction} · resolver {trade.resolverOutcome ?? 'NULL'}
            </div>
            <div className="grid grid-cols-3 gap-1">
              {(['WIN','LOSS','TIE'] as ManualPlatformOutcome[]).map((outcome) => (
                <button key={outcome} disabled={busy} onClick={() => void labelPlatform(trade.tradeId, outcome)} className="rounded bg-slate-800 px-1.5 py-1 text-[8px] font-bold text-slate-300 disabled:opacity-40">
                  Platform {outcome}
                </button>
              ))}
            </div>
          </div>
        ))}

        {summary.selectionBiasWarning && <div className="rounded border border-yellow-500/20 bg-yellow-500/5 p-2 text-[8px] leading-relaxed text-yellow-300">{summary.selectionBiasWarning}</div>}
        {summary.validationComplete && <div className="rounded border border-cyan-500/20 bg-cyan-500/5 p-2 text-[8px] text-cyan-200">30 manual demo labels collected. This only completes the sample count; inspect agreement/null/disagreements before treating the screen resolver as validated.</div>}
        {message && <div className="text-[8px] leading-relaxed text-slate-400">{message}</div>}
      </div>
    </details>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded border border-slate-800 bg-slate-950/60 p-1.5"><div className="text-[7px] uppercase text-slate-600">{label}</div><div className="text-[10px] font-black text-slate-300">{value}</div></div>;
}
