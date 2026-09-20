import { useState } from 'react';

interface SecurityPanelProps {
  authenticated: boolean;
  authConfigured: boolean;
  groqConfigured: boolean;
  tokenPresent: boolean;
  busy: boolean;
  onAuthenticate: (token: string) => Promise<void>;
  onLogout: () => void;
}

export function SecurityPanel({
  authenticated,
  authConfigured,
  groqConfigured,
  tokenPresent,
  busy,
  onAuthenticate,
  onLogout,
}: SecurityPanelProps) {
  const [token, setToken] = useState('');

  if (authenticated) {
    return (
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/55 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          <span className="font-black text-green-400">🔐 AUDIT AUTH OK</span>
          <span className={groqConfigured ? 'text-green-400' : 'text-yellow-300'}>
            {groqConfigured ? '● Server Groq configured' : '● Server Groq key missing'}
          </span>
          <span className="text-slate-600">Client-side Groq key disabled</span>
        </div>
        <button onClick={onLogout} className="rounded bg-slate-800 px-2 py-1 text-[9px] font-bold text-slate-400 hover:bg-slate-700">
          Lock session
        </button>
      </div>
    );
  }

  return (
    <div className="mb-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
      <div className="text-xs font-black text-yellow-300">🔐 Secure audit session required</div>
      <div className="mt-1 text-[10px] leading-relaxed text-slate-500">
        Audit, OCR, replay and Groq proxy endpoints require the server audit token. The token is kept in sessionStorage only and disappears when the browser session is cleared.
      </div>
      {!authConfigured ? (
        <div className="mt-2 text-[10px] font-bold text-red-300">Server AUDIT_AUTH_TOKEN is not configured. All protected routes remain closed.</div>
      ) : (
        <div className="mt-2 flex gap-2">
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={tokenPresent ? 'Token saved for this session — re-enter to replace' : 'Enter AUDIT_AUTH_TOKEN'}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-600 outline-none focus:border-yellow-500"
          />
          <button
            disabled={busy || !token.trim()}
            onClick={() => void onAuthenticate(token.trim())}
            className="rounded-md bg-yellow-400 px-3 py-2 text-[10px] font-black text-slate-950 disabled:opacity-40"
          >
            {busy ? 'Checking…' : 'Authenticate'}
          </button>
        </div>
      )}
    </div>
  );
}
