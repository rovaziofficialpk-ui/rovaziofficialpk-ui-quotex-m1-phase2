import type { ChangeEvent } from 'react';

interface ApiKeyPanelProps {
  apiKey: string;
  onChange: (value: string) => void;
  onClear: () => void;
  onTest: () => Promise<void>;
  testState: 'idle' | 'testing' | 'ok' | 'error';
}

export function ApiKeyPanel({ apiKey, onChange, onClear, onTest, testState }: ApiKeyPanelProps) {
  if (!apiKey) {
    return (
      <div className="mb-2 bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30 rounded-lg p-3">
        <h2 className="text-sm font-bold mb-1">🔑 Connect Groq</h2>
        <p className="text-xs text-slate-400 mb-2">
          Create a Groq API key at <a href="https://console.groq.com" target="_blank" rel="noreferrer" className="text-blue-400 underline">console.groq.com</a>, then paste it below.
        </p>
        <input
          type="password"
          value={apiKey}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
          placeholder="gsk_..."
          autoComplete="off"
          className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-md text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 font-mono"
        />
        <p className="text-[10px] text-slate-500 mt-2">🔒 BYOK: the key is stored only in this browser's localStorage and is not bundled into the deployed site.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/50 rounded-md px-3 py-2 mb-2 border border-slate-800">
      <div className="flex items-center gap-2 text-xs">
        <span className={testState === 'error' ? 'text-red-400' : 'text-green-400'}>●</span>
        <span className="text-slate-400 font-mono">Groq • gsk_...{apiKey.slice(-4)}</span>
        {testState === 'ok' && <span className="text-[10px] text-green-400">Verified</span>}
        {testState === 'error' && <span className="text-[10px] text-red-400">Test failed</span>}
      </div>
      <div className="flex gap-2">
        <button disabled={testState === 'testing'} onClick={() => void onTest()} className="text-[10px] px-2 py-1 bg-blue-500/20 text-blue-400 rounded cursor-pointer hover:bg-blue-500/30 disabled:opacity-50">
          {testState === 'testing' ? 'Testing…' : 'Test'}
        </button>
        <button onClick={onClear} className="text-[10px] text-slate-500 hover:text-slate-300 cursor-pointer">Change</button>
      </div>
    </div>
  );
}
