import type { TradeSignal } from '../signalLogic';
import type { BacktestRow } from './backtest';

export type PrecisionBiasMode = 'BOTH' | 'CALL' | 'PUT';

export interface PrecisionRule {
  minConfidence: number;
  minConfirmations: 3 | 4;
  maxOpposing: 0 | 1;
  requireClear: boolean;
  maxWarnings: number;
  biasMode: PrecisionBiasMode;
}

export interface PrecisionStats {
  rows: number;
  signals: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number | null;
  coverage: number;
  wilsonLower95: number | null;
}

export interface PrecisionProfile {
  version: 1;
  createdAt: string;
  sourcePair: string;
  sourceMarket: string;
  targetWinRate: number;
  trainFraction: number;
  rule: PrecisionRule;
  train: PrecisionStats;
  holdout: PrecisionStats;
  validated: boolean;
  validationReason: string;
}

export interface PrecisionOptimization {
  profile: PrecisionProfile | null;
  trainRows: number;
  holdoutRows: number;
  candidatesTested: number;
  targetWinRate: number;
}

export const PRECISION_TARGET_WIN_RATE = 80;
export const PRECISION_MIN_TRAIN_SIGNALS = 12;
export const PRECISION_MIN_HOLDOUT_SIGNALS = 12;
export const PRECISION_TRAIN_FRACTION = 0.7;

const STORAGE_KEY = 'quotex_m1_precision_profile_v1';

function wilsonLower95(wins: number, losses: number): number | null {
  const n = wins + losses;
  if (!n) return null;
  const z = 1.959963984540054;
  const p = wins / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  const lower = (centre - margin) / (1 + z2 / n);
  return Number((Math.max(0, lower) * 100).toFixed(1));
}

function evaluateRows(rows: BacktestRow[]): PrecisionStats {
  const signals = rows.filter((row) => row.bias !== 'NEUTRAL');
  const wins = signals.filter((row) => row.outcome === 'WIN').length;
  const losses = signals.filter((row) => row.outcome === 'LOSS').length;
  const ties = signals.filter((row) => row.outcome === 'TIE').length;
  const decided = wins + losses;
  return {
    rows: rows.length,
    signals: signals.length,
    wins,
    losses,
    ties,
    winRate: decided > 0 ? Number(((wins / decided) * 100).toFixed(1)) : null,
    coverage: rows.length > 0 ? Number(((signals.length / rows.length) * 100).toFixed(1)) : 0,
    wilsonLower95: wilsonLower95(wins, losses),
  };
}

function rowPassesRule(row: BacktestRow, rule: PrecisionRule): boolean {
  if (row.bias === 'NEUTRAL') return false;
  if (row.confidence < rule.minConfidence) return false;
  if (row.confirmationCount < rule.minConfirmations) return false;
  if (row.opposingConfirmations > rule.maxOpposing) return false;
  if (rule.requireClear && row.chartQuality !== 'clear') return false;
  if (row.warningCount > rule.maxWarnings) return false;
  if (rule.biasMode !== 'BOTH' && row.bias !== rule.biasMode) return false;
  return true;
}

function signalPassesRule(signal: TradeSignal, rule: PrecisionRule): string | null {
  if (signal.bias === 'NEUTRAL') return signal.gateReason || 'Base strategy returned NEUTRAL.';
  if (signal.confidence < rule.minConfidence) return `confidence ${signal.confidence}% < precision minimum ${rule.minConfidence}%`;
  if (signal.confirmationCount < rule.minConfirmations) return `${signal.confirmationCount}/4 confirmations < precision minimum ${rule.minConfirmations}/4`;
  if (signal.opposingConfirmations > rule.maxOpposing) return `${signal.opposingConfirmations} opposing confirmations > precision maximum ${rule.maxOpposing}`;
  if (rule.requireClear && signal.chartQuality !== 'clear') return `chart quality is ${signal.chartQuality}; precision profile requires clear`;
  if (signal.warnings.length > rule.maxWarnings) return `${signal.warnings.length} warnings > precision maximum ${rule.maxWarnings}`;
  if (rule.biasMode !== 'BOTH' && signal.bias !== rule.biasMode) return `precision profile currently allows ${rule.biasMode} signals only`;
  return null;
}

function candidateRules(): PrecisionRule[] {
  const rules: PrecisionRule[] = [];
  const confidences = [70, 75, 80, 85, 90, 95];
  const confirmations: Array<3 | 4> = [3, 4];
  const oppositions: Array<0 | 1> = [0, 1];
  const clearModes = [false, true];
  const warningCaps = [0, 1, 99];
  const biasModes: PrecisionBiasMode[] = ['BOTH', 'CALL', 'PUT'];

  for (const minConfidence of confidences) {
    for (const minConfirmations of confirmations) {
      for (const maxOpposing of oppositions) {
        for (const requireClear of clearModes) {
          for (const maxWarnings of warningCaps) {
            for (const biasMode of biasModes) {
              rules.push({ minConfidence, minConfirmations, maxOpposing, requireClear, maxWarnings, biasMode });
            }
          }
        }
      }
    }
  }
  return rules;
}

function scoreCandidate(stats: PrecisionStats, target: number): number {
  const lower = stats.wilsonLower95 ?? 0;
  const rate = stats.winRate ?? 0;
  const targetBonus = rate >= target ? 30 : 0;
  const sampleBonus = Math.min(15, stats.signals / 2);
  const coverageBonus = Math.min(10, stats.coverage / 4);
  return lower * 2 + rate * 0.35 + targetBonus + sampleBonus + coverageBonus;
}

export function optimizePrecisionProfile(
  allRows: BacktestRow[],
  sourcePair: string,
  sourceMarket: string,
  targetWinRate = PRECISION_TARGET_WIN_RATE,
): PrecisionOptimization {
  const ordered = [...allRows].sort((a, b) => a.timestamp - b.timestamp || a.index - b.index);
  if (ordered.length < 40) {
    return { profile: null, trainRows: 0, holdoutRows: 0, candidatesTested: 0, targetWinRate };
  }

  const splitIndex = Math.max(1, Math.min(ordered.length - 1, Math.floor(ordered.length * PRECISION_TRAIN_FRACTION)));
  const trainRows = ordered.slice(0, splitIndex);
  const holdoutRows = ordered.slice(splitIndex);

  let best: { rule: PrecisionRule; stats: PrecisionStats; score: number } | null = null;
  const rules = candidateRules();

  for (const rule of rules) {
    const filtered = trainRows.filter((row) => rowPassesRule(row, rule));
    const stats = evaluateRows(filtered);
    const decided = stats.wins + stats.losses;
    if (decided < PRECISION_MIN_TRAIN_SIGNALS) continue;
    const score = scoreCandidate(stats, targetWinRate);
    if (!best || score > best.score || (score === best.score && stats.signals > best.stats.signals)) {
      best = { rule, stats, score };
    }
  }

  if (!best) {
    return {
      profile: null,
      trainRows: trainRows.length,
      holdoutRows: holdoutRows.length,
      candidatesTested: rules.length,
      targetWinRate,
    };
  }

  const holdoutFiltered = holdoutRows.filter((row) => rowPassesRule(row, best.rule));
  const holdoutStats = evaluateRows(holdoutFiltered);
  const holdoutDecided = holdoutStats.wins + holdoutStats.losses;
  const validated = holdoutStats.winRate !== null
    && holdoutStats.winRate >= targetWinRate
    && holdoutDecided >= PRECISION_MIN_HOLDOUT_SIGNALS;

  const validationReason = validated
    ? `Untouched holdout reached ${holdoutStats.winRate}% across ${holdoutDecided} decided signals.`
    : holdoutDecided < PRECISION_MIN_HOLDOUT_SIGNALS
      ? `Holdout has only ${holdoutDecided} decided signals; need at least ${PRECISION_MIN_HOLDOUT_SIGNALS} before enabling this profile live.`
      : `Untouched holdout reached ${holdoutStats.winRate ?? 0}%, below the ${targetWinRate}% target.`;

  return {
    profile: {
      version: 1,
      createdAt: new Date().toISOString(),
      sourcePair,
      sourceMarket,
      targetWinRate,
      trainFraction: PRECISION_TRAIN_FRACTION,
      rule: best.rule,
      train: best.stats,
      holdout: holdoutStats,
      validated,
      validationReason,
    },
    trainRows: trainRows.length,
    holdoutRows: holdoutRows.length,
    candidatesTested: rules.length,
    targetWinRate,
  };
}

export function applyPrecisionProfile(signal: TradeSignal, profile: PrecisionProfile | null): TradeSignal {
  if (!profile?.validated || signal.bias === 'NEUTRAL') return signal;
  const reason = signalPassesRule(signal, profile.rule);
  if (!reason) return signal;
  return {
    ...signal,
    bias: 'NEUTRAL',
    gateReason: `Precision profile blocked: ${reason}.`,
    entry: 'No directional signal. The validated precision profile requires a stronger setup.',
  };
}

export function savePrecisionProfile(profile: PrecisionProfile | null): void {
  try {
    if (!profile) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Storage failures should not break analysis.
  }
}

export function loadPrecisionProfile(): PrecisionProfile | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PrecisionProfile;
    if (
      parsed?.version !== 1
      || !parsed.validated
      || typeof parsed.createdAt !== 'string'
      || !parsed.rule
      || typeof parsed.rule.minConfidence !== 'number'
      || ![3, 4].includes(parsed.rule.minConfirmations)
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}
