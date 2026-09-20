const TOKEN_KEY = 'quotex_audit_auth_session_v1';

export interface ServerHealth {
  ok: boolean;
  durableAudit: boolean;
  authConfigured: boolean;
  groqConfigured: boolean;
  ocrConfigured: boolean;
  auditLock: boolean;
}

export function loadAuditToken(): string {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function saveAuditToken(token: string): void {
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Session storage failure must not unlock any gate.
  }
}

export function clearAuditToken(): void {
  saveAuditToken('');
}

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = loadAuditToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('X-Audit-Token', token);
  return fetch(input, { ...init, headers, credentials: 'same-origin' });
}

export async function getServerHealth(): Promise<ServerHealth> {
  const response = await fetch('/api/health', { cache: 'no-store' });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error || 'Server health check failed.');
  return data as ServerHealth;
}

export async function verifyAuditAuth(): Promise<{ authenticated: boolean; groqConfigured: boolean }> {
  const response = await apiFetch('/api/auth/check', { method: 'GET', cache: 'no-store' });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error || 'Audit authentication failed.');
  return { authenticated: true, groqConfigured: Boolean(data.groqConfigured) };
}

export async function logSettingChange(setting: string, oldValue: unknown, newValue: unknown, configVersion: string): Promise<void> {
  try {
    await apiFetch('/api/settings/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setting, oldValue, newValue, configVersion }),
    });
  } catch {
    // Settings logging failure never relaxes validation.
  }
}
