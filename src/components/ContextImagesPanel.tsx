import type { ChangeEvent } from 'react';
import type { ContextLabel } from '../services/groq';

interface ContextImagesPanelProps {
  images: Record<ContextLabel, string | null>;
  onUpload: (label: ContextLabel, event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: (label: ContextLabel) => void;
}

export function ContextImagesPanel({ images, onUpload, onRemove }: ContextImagesPanelProps) {
  return (
    <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <div className="text-xs text-slate-300 font-semibold">🧭 Optional higher-timeframe context</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Add M5 and/or H1 screenshots. Conflicting context can block a directional result.</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(['M5', 'H1'] as ContextLabel[]).map((label) => (
          <div key={label} className="rounded-md border border-slate-700 bg-slate-900/60 p-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-black text-slate-300">{label}</span>
              {images[label] && <button onClick={() => onRemove(label)} className="text-[10px] text-red-400 hover:text-red-300">Remove</button>}
            </div>
            {images[label] ? (
              <img src={images[label] || ''} alt={`${label} context`} className="w-full h-24 object-cover rounded border border-slate-800" />
            ) : (
              <label className="h-24 rounded border border-dashed border-slate-700 hover:border-blue-400 flex items-center justify-center text-[10px] text-slate-500 cursor-pointer">
                + Add {label}
                <input type="file" accept="image/*" className="hidden" onChange={(event: ChangeEvent<HTMLInputElement>) => onUpload(label, event)} />
              </label>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
