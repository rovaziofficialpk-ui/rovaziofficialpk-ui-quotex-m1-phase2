import type { SignalHistoryItem } from '../signalLogic';

const KEYS = {
  apiKey: 'quotex_m1_groq_api_key',
  settings: 'quotex_m1_settings_v2',
  history: 'quotex_m1_history_v2',
} as const;

export interface AppSettings {
  minConfidence: number;
  autoIntervalSeconds: number;
}

const DEFAULT_SETTINGS: AppSettings = { minConfidence: 70, autoIntervalSeconds: 5 };
const MAX_HISTORY = 100;

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function safeGet(key: string): string | null {
  if (!canUseStorage()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private browsing/storage quota should not break the app.
  }
}

export function loadApiKey(): string {
  return safeGet(KEYS.apiKey) || safeGet('groq_api_key') || '';
}

export function saveApiKey(value: string): void {
  safeSet(KEYS.apiKey, value);
}

export function clearApiKey(): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(KEYS.apiKey);
    window.localStorage.removeItem('groq_api_key');
  } catch {
    // Ignore storage failures.
  }
}

export function loadSettings(): AppSettings {
  try {
    const parsed = JSON.parse(safeGet(KEYS.settings) || 'null') as Partial<AppSettings> | null;
    const minConfidence = Number(parsed?.minConfidence);
    const autoIntervalSeconds = Number(parsed?.autoIntervalSeconds);
    return {
      minConfidence: Number.isFinite(minConfidence)
        ? Math.max(50, Math.min(90, Math.round(minConfidence)))
        : DEFAULT_SETTINGS.minConfidence,
      autoIntervalSeconds: [3, 5, 10, 15, 30].includes(autoIntervalSeconds)
        ? autoIntervalSeconds
        : DEFAULT_SETTINGS.autoIntervalSeconds,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  safeSet(KEYS.settings, JSON.stringify(settings));
}

export function loadHistory(): SignalHistoryItem[] {
  try {
    const parsed = JSON.parse(safeGet(KEYS.history) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
      .slice(0, MAX_HISTORY) as SignalHistoryItem[];
  } catch {
    return [];
  }
}

export function saveHistory(history: SignalHistoryItem[]): void {
  safeSet(KEYS.history, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

export const HISTORY_LIMIT = MAX_HISTORY;
