import type { SignalHistoryItem } from '../signalLogic';

function downloadBlob(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export function exportHistoryJson(history: SignalHistoryItem[]): void {
  downloadBlob(
    `quotex-signal-history-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(history, null, 2),
    'application/json;charset=utf-8',
  );
}

export function exportHistoryCsv(history: SignalHistoryItem[]): void {
  const headers = [
    'createdAt', 'pair', 'finalBias', 'proposedBias', 'confidence', 'threshold', 'timeframe',
    'chartQuality', 'inputQualityScore', 'confirmationScore', 'confirmationCount', 'opposingConfirmations',
    'trend', 'momentum', 'structure', 'candleSignal', 'supportResistance', 'contextImagesUsed',
    'contextAlignment', 'contextNotes', 'pattern', 'entry', 'gateReason', 'responseTimeMs', 'evidence', 'warnings',
  ];
  const rows = history.map((item) => [
    item.createdAt,
    item.pair,
    item.bias,
    item.proposedBias,
    item.confidence,
    item.minConfidence,
    item.timeframe,
    item.chartQuality,
    item.inputQualityScore ?? '',
    item.confirmationScore ?? '',
    item.confirmationCount ?? '',
    item.opposingConfirmations ?? '',
    item.trend ?? '',
    item.momentum ?? '',
    item.structure ?? '',
    item.candleSignal ?? '',
    item.supportResistance ?? '',
    item.contextImagesUsed ?? '',
    item.contextAlignment ?? '',
    item.contextNotes ?? '',
    item.pattern,
    item.entry,
    item.gateReason || '',
    item.responseTimeMs,
    item.evidence?.join(' | ') || '',
    item.warnings.join(' | '),
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
  downloadBlob(
    `quotex-signal-history-${new Date().toISOString().slice(0, 10)}.csv`,
    csv,
    'text/csv;charset=utf-8',
  );
}
